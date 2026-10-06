// The guard: an elevated background process (started once, one UAC prompt) that applies a game's blocks while that game
// is running and removes them when it is closed. Blocks marked "always" are not its business.
//   GameNetKit.exe --guard            started by the UI; stops when guard-stop.flag appears (or on reboot / logoff)
// State is exchanged through files in the data folder: blocks.json (read), guard.json (written every 2 s).
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
        // games.json next to the exe, or the built-in list when there is none
        public static List<Dictionary<string, object>> Load(string exeDir, JavaScriptSerializer js)
        {
            try
            {
                string p = Path.Combine(exeDir, "games.json");
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
                Game("Fortnite", "FortniteClient-Win64-Shipping.exe")
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

        static readonly JavaScriptSerializer Js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        static void Log(string line)
        {
            try { File.AppendAllText(Path.Combine(Program.DataDir, "guard-log.txt"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine); } catch { }
        }

        // the "game" mode blocks: target -> game name
        static Dictionary<string, string> GameBlocks()
        {
            var d = new Dictionary<string, string>();
            for (int i = 0; i < 3; i++)
            {
                try
                {
                    if (!File.Exists(BlocksPath)) return d;
                    foreach (object o in (object[])Js.DeserializeObject(File.ReadAllText(BlocksPath)))
                    {
                        var b = (Dictionary<string, object>)o;
                        if (b.ContainsKey("mode") && Convert.ToString(b["mode"]) == "game" && Firewall.ValidIp(Convert.ToString(b["ip"])))
                            d[Convert.ToString(b["ip"])] = b.ContainsKey("game") ? Convert.ToString(b["game"]) : "";
                    }
                    return d;
                }
                catch { Thread.Sleep(50); }   // the UI may be writing the file right now
            }
            return d;
        }

        static void WriteState(List<string> running, List<string> applied, string error)
        {
            var st = new Dictionary<string, object>
            {
                { "pid", Process.GetCurrentProcess().Id },
                { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) },
                { "running", running }, { "applied", applied }, { "error", error }
            };
            string tmp = StatePath + ".tmp";
            try { File.WriteAllText(tmp, Js.Serialize(st), new UTF8Encoding(false)); File.Copy(tmp, StatePath, true); } catch { }
        }

        public static int Run()
        {
            bool created;
            using (var mutex = new Mutex(true, Program.DemoMode ? "GameNetKit.Guard.Demo" : "GameNetKit.Guard", out created))
            {
                if (!created) return 0;
                Directory.CreateDirectory(Program.DataDir);
                try { File.Delete(StopPath); } catch { }
                string exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                var applied = new HashSet<string>();
                var retryAt = new Dictionary<string, DateTime>();
                string error = "";
                Log("guard started (demo=" + Program.DemoMode + ")");

                // a guard that died while a block was applied may have left it behind: clear game-mode targets first
                if (!Program.DemoMode)
                {
                    var gb0 = GameBlocks();
                    foreach (var kv in Firewall.ListTargets())
                        if (gb0.ContainsKey(kv.Key)) { Firewall.Remove(kv.Key); Log("cleared leftover " + kv.Key); }
                }

                while (!File.Exists(StopPath))
                {
                    var games = GameList.Load(exeDir, Js);
                    var running = new List<string>();
                    foreach (var g in games)
                        if (GameList.IsRunning(Convert.ToString(g["process"]))) running.Add(Convert.ToString(g["name"]));

                    var blocks = GameBlocks();
                    var desired = new HashSet<string>(blocks.Where(kv => running.Contains(kv.Value)).Select(kv => kv.Key));

                    foreach (string t in desired.Where(x => !applied.Contains(x)).ToList())
                    {
                        DateTime when;
                        if (retryAt.TryGetValue(t, out when) && DateTime.Now < when) continue;
                        int rc = Program.DemoMode ? 0 : Firewall.Apply(t, true);
                        Log("apply " + t + " (" + blocks[t] + ") rc=" + rc);
                        if (rc == 0) { applied.Add(t); retryAt.Remove(t); error = ""; }
                        else { retryAt[t] = DateTime.Now.AddSeconds(30); error = "could not block " + t; }
                    }
                    foreach (string t in applied.Where(x => !desired.Contains(x)).ToList())
                    {
                        if (!Program.DemoMode) Firewall.Remove(t);
                        applied.Remove(t);
                        Log("removed " + t);
                    }

                    WriteState(running, applied.ToList(), error);
                    for (int i = 0; i < 4 && !File.Exists(StopPath); i++) Thread.Sleep(500);
                }

                foreach (string t in applied.ToList()) { if (!Program.DemoMode) Firewall.Remove(t); Log("removed " + t + " (guard stopped)"); }
                try { File.Delete(StatePath); } catch { }
                Log("guard stopped");
            }
            return 0;
        }
    }
}
