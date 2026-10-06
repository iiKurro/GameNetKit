// The guard: an elevated background process (started once, one UAC prompt) that applies a game's blocks while that game
// is running and removes them when it is closed. Blocks marked "always" are not its business.
//   GameNetKit.exe --guard            started by the UI; stops when guard-stop.flag appears (or on reboot / logoff)
// State is exchanged through files in the data folder: blocks.json (read), guard.json (written every 2 s by its own thread, so a slow
// firewall command never makes the window think the guard is gone) and guard-applied.json (what the guard has switched on, so a guard
// that was killed or lost to a logoff can clean up after itself the next time it starts).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GameNetKit
{
    public static class GameList
    {
        // games.json next to the exe, or the built-in list when there is none. The window mirrors it into the data folder, which is
        // where the guard (running from another folder) reads it, so a game added by hand is seen by both.
        public static List<Dictionary<string, object>> Load(string exeDir, JavaScriptSerializer js, bool forGuard)
        {
            try
            {
                string p = Path.Combine(exeDir, "games.json");
                string mirror = Path.Combine(Program.DataDir, "games.json");
                if (forGuard) { if (File.Exists(mirror)) p = mirror; }
                else if (File.Exists(p))
                {
                    try { if (!File.Exists(mirror) || File.ReadAllText(mirror) != File.ReadAllText(p)) { Directory.CreateDirectory(Program.DataDir); File.Copy(p, mirror, true); } } catch { }
                }
                if (File.Exists(p))
                    return ((object[])js.DeserializeObject(File.ReadAllText(p))).Select(o => (Dictionary<string, object>)o).ToList();
            }
            catch { }
            return new List<Dictionary<string, object>>
            {
                Game("Rocket League", "RocketLeague.exe"),
                Game("Overwatch 2", "Overwatch.exe"),
                // Call of Duty HQ games all run as cod.exe, so only the game you pick decides which history a scan goes to.
                Game("Modern Warfare 3", "cod.exe"),
                // Modern Warfare 4 is released on 2026-10-23; its exe name is a guess (same launcher family) until someone checks it.
                Game("Modern Warfare 4", "cod.exe"),
                Game("Fortnite", "FortniteClient-Win64-Shipping.exe"),
                // Task Manager shows PioneerGame.exe for ARC Raiders (the -Win64-Shipping name is covered too, in case a build uses it)
                Game("ARC Raiders", "PioneerGame.exe|PioneerGame-Win64-Shipping.exe")
            };
        }

        static Dictionary<string, object> Game(string name, string process)
        {
            return new Dictionary<string, object> { { "name", name }, { "process", process }, { "enabled", true } };
        }

        // "cod.exe|other.exe" -> every running process with one of these names
        public static bool IsRunning(string processField)
        {
            foreach (string n in (processField ?? "").Split('|'))
            {
                string name = n.Trim();
                if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);
                if (name == "") continue;
                Process[] ps = Process.GetProcessesByName(name);
                bool any = ps.Length > 0;
                foreach (Process p in ps) p.Dispose();
                if (any) return true;
            }
            return false;
        }
    }

    public static class Guard
    {
        public static string StatePath { get { return Path.Combine(Program.DataDir, "guard.json"); } }
        public static string StopPath { get { return Path.Combine(Program.DataDir, "guard-stop.flag"); } }
        static string BlocksPath { get { return Path.Combine(Program.DataDir, Program.DemoMode ? "blocks-demo.json" : "blocks.json"); } }
        static string AppliedPath { get { return Path.Combine(Program.DataDir, Program.DemoMode ? "guard-applied-demo.json" : "guard-applied.json"); } }

        static readonly JavaScriptSerializer Js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        static void Log(string line)
        {
            try { File.AppendAllText(Path.Combine(Program.DataDir, "guard-log.txt"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine); } catch { }
        }

        // every entry of blocks.json: target -> mode ("game" / "always")
        static Dictionary<string, string> lastGoodModes = new Dictionary<string, string>();
        // the "game" mode blocks: target -> game name. null = the file could not be read (the caller keeps what it had)
        static Dictionary<string, string> GameBlocks()
        {
            for (int i = 0; i < 3; i++)
            {
                try
                {
                    var d = new Dictionary<string, string>();
                    var modes = new Dictionary<string, string>();
                    if (File.Exists(BlocksPath))
                        foreach (object o in (object[])Js.DeserializeObject(File.ReadAllText(BlocksPath)))
                        {
                            var b = (Dictionary<string, object>)o;
                            string ip = Convert.ToString(b["ip"]);
                            string mode = b.ContainsKey("mode") ? Convert.ToString(b["mode"]) : "always";
                            modes[ip] = mode;
                            if (mode == "game" && Firewall.ValidIp(ip)) d[ip] = b.ContainsKey("game") ? Convert.ToString(b["game"]) : "";
                        }
                    lastGoodModes = modes;
                    return d;
                }
                catch { Thread.Sleep(80); }   // the UI may be writing the file right now
            }
            return null;
        }

        // ---- state shared with the heartbeat thread
        static readonly object stLock = new object();
        static List<string> stRunning = new List<string>(), stApplied = new List<string>();
        static string stError = "";
        static volatile bool stopHeart;

        static void SetState(List<string> running, IEnumerable<string> applied, string error)
        {
            lock (stLock) { stRunning = running; stApplied = applied.ToList(); stError = error; }
        }

        static void WriteState()
        {
            Dictionary<string, object> st;
            lock (stLock)
                st = new Dictionary<string, object>
                {
                    { "pid", Process.GetCurrentProcess().Id },
                    { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) },
                    { "running", stRunning }, { "applied", stApplied }, { "error", stError }, { "version", Program.Version }
                };
            string tmp = StatePath + ".tmp";
            try { File.WriteAllText(tmp, Js.Serialize(st), new UTF8Encoding(false)); File.Copy(tmp, StatePath, true); } catch { }
        }

        static void SaveApplied(IEnumerable<string> applied)
        {
            try { File.WriteAllText(AppliedPath, Js.Serialize(applied.ToList()), new UTF8Encoding(false)); } catch { }
        }

        // what a guard that died (killed, logoff, crash) left switched on
        static void CleanLeftovers()
        {
            if (Program.DemoMode) return;
            var gb = GameBlocks();
            var cleared = new HashSet<string>();
            try
            {
                if (File.Exists(AppliedPath))
                    foreach (object o in (object[])Js.DeserializeObject(File.ReadAllText(AppliedPath)))
                    {
                        string t = Convert.ToString(o);
                        string mode;
                        // a target the user turned into an "always" block meanwhile is theirs now: leave it alone
                        if (!Firewall.ValidIp(t) || (lastGoodModes.TryGetValue(t, out mode) && mode == "always")) continue;
                        Firewall.Remove(t); cleared.Add(t); Log("cleared leftover " + t + " (from the previous guard)");
                    }
            }
            catch (Exception e) { Log("could not read guard-applied.json: " + e.Message); }
            if (gb != null)
                foreach (var kv in Firewall.ListTargets())
                    if (gb.ContainsKey(kv.Key) && cleared.Add(kv.Key)) { Firewall.Remove(kv.Key); Log("cleared leftover " + kv.Key); }
            SaveApplied(new string[0]);
        }

        public static int Run()
        {
            bool created;
            using (var mutex = new Mutex(true, (Program.DemoMode ? "GameNetKit.Guard.Demo" : "GameNetKit.Guard") + Program.InstanceSuffix, out created))
            {
                if (!created) return 0;
                Directory.CreateDirectory(Program.DataDir);
                try { File.Delete(StopPath); } catch { }
                string exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                var applied = new HashSet<string>();
                var retryAt = new Dictionary<string, DateTime>();
                string error = "";
                Log("guard started (demo=" + Program.DemoMode + ")");
                CleanLeftovers();

                // its own thread: firewall commands can take half a minute, and the window must keep seeing a living guard meanwhile
                var heart = new Thread(() => { while (!stopHeart) { WriteState(); for (int i = 0; i < 20 && !stopHeart; i++) Thread.Sleep(100); } }) { IsBackground = true };
                SetState(new List<string>(), applied, error);
                heart.Start();

                var blocks = new Dictionary<string, string>();
                while (!File.Exists(StopPath))
                {
                    try
                    {
                        var games = GameList.Load(exeDir, Js, true);
                        var running = new List<string>();
                        foreach (var g in games)
                            if (GameList.IsRunning(Convert.ToString(g["process"]))) running.Add(Convert.ToString(g["name"]));

                        var fresh = GameBlocks();
                        if (fresh != null) blocks = fresh;   // unreadable file: keep the last good list instead of dropping every block mid-match
                        var desired = new HashSet<string>(blocks.Where(kv => running.Contains(kv.Value)).Select(kv => kv.Key));

                        foreach (string t in desired.Where(x => !applied.Contains(x)).ToList())
                        {
                            DateTime when;
                            if (retryAt.TryGetValue(t, out when) && DateTime.Now < when) continue;
                            int rc = Program.DemoMode ? 0 : Firewall.Apply(t, true);
                            Log("apply " + t + " (" + blocks[t] + ") rc=" + rc);
                            if (rc == 0) { applied.Add(t); retryAt.Remove(t); error = ""; SaveApplied(applied); }
                            else { retryAt[t] = DateTime.Now.AddSeconds(30); error = "could not block " + t; }
                        }
                        foreach (string t in applied.Where(x => !desired.Contains(x)).ToList())
                        {
                            if (!Program.DemoMode) Firewall.Remove(t);
                            applied.Remove(t);
                            SaveApplied(applied);
                            Log("removed " + t);
                        }
                        SetState(running, applied, error);
                    }
                    catch (Exception e)
                    {
                        // a bad games.json, a process that vanished while being listed ...: never let it kill the guard (and leave blocks behind)
                        error = "guard hiccup: " + e.Message;
                        Log("loop error: " + e);
                        SetState(new List<string>(), applied, error);
                    }
                    for (int i = 0; i < 4 && !File.Exists(StopPath); i++) Thread.Sleep(500);
                }

                foreach (string t in applied.ToList()) { if (!Program.DemoMode) Firewall.Remove(t); Log("removed " + t + " (guard stopped)"); }
                SaveApplied(new string[0]);
                stopHeart = true; heart.Join(1500);
                try { File.Delete(StatePath); } catch { }
                Log("guard stopped");
            }
            return 0;
        }
    }
}
