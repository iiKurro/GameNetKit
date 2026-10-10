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
            var list = LoadBase(exeDir, js, forGuard);
            ApplyOverrides(list, js);
            AddArtSources(list);
            return list;
        }

        // Where the pictures of the known games come from (their store pages). Built in, so they are found also when the program runs alone
        // (no games.json beside it); a games.json that names its own "steam" / "epic" wins.
        static readonly Dictionary<string, KeyValuePair<string, object>> ArtSources = new Dictionary<string, KeyValuePair<string, object>>(StringComparer.OrdinalIgnoreCase)
        {
            { "Rocket League", new KeyValuePair<string, object>("steam", 252950L) },
            { "Overwatch 2", new KeyValuePair<string, object>("steam", 2357570L) },
            { "Modern Warfare 3", new KeyValuePair<string, object>("steam", 3595270L) },
            { "Modern Warfare 4", new KeyValuePair<string, object>("steam", 4435490L) },
            { "Fortnite", new KeyValuePair<string, object>("epic", "fortnite") },
            { "ARC Raiders", new KeyValuePair<string, object>("steam", 1808500L) },
            { "AION 2", new KeyValuePair<string, object>("steam", 3393110L) }
        };

        static void AddArtSources(List<Dictionary<string, object>> list)
        {
            foreach (var g in list)
            {
                KeyValuePair<string, object> a;
                if (!g.ContainsKey("steam") && !g.ContainsKey("epic") && ArtSources.TryGetValue(Convert.ToString(g["name"]), out a)) g[a.Key] = a.Value;
            }
        }

        // processes the player picked for a game ("this is my game") are added to what the list says; both the window and the guard read them
        public static string OverridesPath { get { return Path.Combine(Program.DataDir, "game-processes.json"); } }

        static void ApplyOverrides(List<Dictionary<string, object>> list, JavaScriptSerializer js)
        {
            try
            {
                if (!File.Exists(OverridesPath)) return;
                var ov = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(OverridesPath));
                foreach (var g in list)
                {
                    string name = Convert.ToString(g["name"]);
                    if (!ov.ContainsKey(name)) continue;
                    string have = Convert.ToString(g["process"]);
                    foreach (string extra in Convert.ToString(ov[name]).Split('|'))
                        if (extra.Trim() != "" && !have.Split('|').Any(x => string.Equals(x.Trim(), extra.Trim(), StringComparison.OrdinalIgnoreCase))) have += "|" + extra.Trim();
                    g["process"] = have;
                }
            }
            catch { }
        }

        static List<Dictionary<string, object>> LoadBase(string exeDir, JavaScriptSerializer js, bool forGuard)
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
                // the Game Pass / newer launchers name the same game cod23-cod.exe; both are watched
                Game("Modern Warfare 3", "cod.exe|cod23-cod.exe|title:Modern Warfare&III"),
                // Modern Warfare 4 is released on 2026-10-23; its exe name is a guess (same launcher family) until someone checks it.
                Game("Modern Warfare 4", "cod.exe"),
                Game("Fortnite", "FortniteClient-Win64-Shipping.exe"),
                // Task Manager shows PioneerGame.exe for ARC Raiders (the -Win64-Shipping name is covered too, in case a build uses it)
                Game("ARC Raiders", "PioneerGame.exe|PioneerGame-Win64-Shipping.exe"),
                // AION 2 (Unreal Engine): Steam app 3393110, the game's exe is Aion2\Binaries\Win64\AION2.exe
                Game("AION 2", "AION2.exe")
            };
        }

        static Dictionary<string, object> Game(string name, string process)
        {
            return new Dictionary<string, object> { { "name", name }, { "process", process }, { "enabled", true } };
        }

        // "cod.exe|other.exe|title:Modern Warfare&III" -> every running process with one of these names, and, when none is found by name,
        // the programs whose window title contains every word after "title:" (separated by &). Some launchers give the same game another
        // program name, and the window title is what Task Manager shows as the game's name.
        public static List<Process> Match(string processField)
        {
            var list = new List<Process>();
            var titles = new List<string[]>();
            foreach (string n in (processField ?? "").Split('|'))
            {
                string name = n.Trim();
                if (name.StartsWith("title:", StringComparison.OrdinalIgnoreCase))
                {
                    titles.Add(name.Substring(6).Split('&').Select(x => x.Trim()).Where(x => x != "").ToArray());
                    continue;
                }
                if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);
                if (name == "") continue;
                list.AddRange(Process.GetProcessesByName(name));
            }
            if (list.Count == 0 && titles.Count > 0)
            {
                foreach (Process p in Process.GetProcesses())
                {
                    bool keep = false;
                    try
                    {
                        string t = p.MainWindowTitle;
                        if (!string.IsNullOrEmpty(t))
                            foreach (var words in titles)
                                if (words.Length > 0 && words.All(w => t.IndexOf(w, StringComparison.OrdinalIgnoreCase) >= 0)) keep = true;
                    }
                    catch { }
                    if (keep) list.Add(p); else p.Dispose();
                }
            }
            return list;
        }

        public static bool IsRunning(string processField)
        {
            var found = Match(processField);
            bool any = found.Count > 0;
            foreach (Process p in found) p.Dispose();
            return any;
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

        static List<string> stRegion = new List<string>();
        static void SetRegion(IEnumerable<string> games) { lock (stLock) stRegion = games.ToList(); }

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
                    { "running", stRunning }, { "applied", stApplied }, { "error", stError }, { "version", Program.Version }, { "regionLocked", stRegion }
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
                // region lock: game -> program path the rules were made for; a failed try waits a minute before the next
                var regionOn = new Dictionary<string, string>();
                var regionRetry = new Dictionary<string, DateTime>();
                List<string> regionRanges = null;
                if (!Program.DemoMode) { string o0; RegionLock.Remove(null, out o0); }     // rules a dead guard left behind
                while (!File.Exists(StopPath))
                {
                    try
                    {
                        var games = GameList.Load(exeDir, Js, true);
                        var running = new List<string>();
                        var exePaths = new Dictionary<string, string>();
                        foreach (var g in games)
                        {
                            string gname = Convert.ToString(g["name"]);
                            var found = GameList.Match(Convert.ToString(g["process"]));
                            if (found.Count > 0)
                            {
                                running.Add(gname);
                                try { exePaths[gname] = found[0].MainModule.FileName; } catch { }
                            }
                            foreach (Process fp in found) fp.Dispose();
                        }

                        // region lock: on while a locked game runs, off when it stops or the switch is turned off
                        if (!Program.DemoMode)
                        {
                            var locked = RegionLock.LockedGames();
                            foreach (string gname in running.Where(x => locked.Contains(x) && exePaths.ContainsKey(x)).ToList())
                            {
                                string path = exePaths[gname], was;
                                if (regionOn.TryGetValue(gname, out was) && was == path) continue;
                                DateTime again;
                                if (regionRetry.TryGetValue(gname, out again) && DateTime.Now < again) continue;
                                string why = "", o1 = "";
                                if (regionRanges == null) regionRanges = RegionLock.BlockedRanges(out why);
                                int rc = regionRanges == null ? 1 : RegionLock.Apply(gname, path, regionRanges, out o1);
                                Log("region lock " + gname + " rc=" + rc + " ranges=" + (regionRanges == null ? 0 : regionRanges.Count) + " " + why + " " + o1.Trim());
                                if (rc == 0) { regionOn[gname] = path; regionRetry.Remove(gname); error = ""; }
                                else { regionRetry[gname] = DateTime.Now.AddMinutes(1); error = "region lock failed for " + gname; if (regionRanges != null && regionRanges.Count == 0) regionRanges = null; }
                            }
                            foreach (string gname in regionOn.Keys.Where(x => !running.Contains(x) || !locked.Contains(x)).ToList())
                            {
                                string o2;
                                RegionLock.Remove(gname, out o2);
                                regionOn.Remove(gname);
                                Log("region lock removed for " + gname);
                            }
                            SetRegion(regionOn.Keys);
                        }

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

                if (!Program.DemoMode && regionOn.Count > 0) { string o3; RegionLock.Remove(null, out o3); Log("region lock removed (guard stopped)"); }
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
