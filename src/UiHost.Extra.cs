// UiHost part 2: blocked servers (firewall) and per-game run history. C# 5 / .NET Framework 4.
//
// Layout on disk (nothing is ever shared between games):
//   History\<Game>\<Game>_yyyyMMdd_HHmmss.json   one file per scan
//   Results\<Game>\<Game>_yyyyMMdd_HHmmss.csv    same scan as CSV
//   Exports\GameNetKit_<Game>_history_*.json     exported history of one game
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace GameNetKit
{
    public partial class UiHost
    {
        readonly object fileLock = new object();
        bool Demo { get { return args.ContainsKey("demo"); } }
        string BlocksPath { get { return Path.Combine(Program.DataDir, Demo ? "blocks-demo.json" : "blocks.json"); } }
        string HistoryRoot { get { return Path.Combine(Program.DataDir, Demo ? "History-demo" : "History"); } }
        string ResultsRoot { get { return Path.Combine(Program.DataDir, Demo ? "Results-demo" : "Results"); } }

        static Dictionary<string, object> Fail(string err)
        {
            return new Dictionary<string, object> { { "ok", false }, { "error", err } };
        }

        static Dictionary<string, object> FwFail(string err, string why)
        {
            string detail = (why != "" ? why + "\n" : "") + Firewall.LastLog();
            return new Dictionary<string, object> { { "ok", false }, { "error", err }, { "detail", detail } };
        }

        // ------------------------------------------------------------------ blocked servers
        // Throws when the file exists but cannot be read (so a read problem is never mistaken for "no blocks" and written over the real list).
        List<Dictionary<string, object>> LoadBlocksStrict()
        {
            lock (fileLock)
            {
                if (!File.Exists(BlocksPath)) return new List<Dictionary<string, object>>();
                Exception last = null;
                for (int i = 0; i < 3; i++)
                {
                    try { return ((object[])js.DeserializeObject(File.ReadAllText(BlocksPath))).Select(o => (Dictionary<string, object>)o).ToList(); }
                    catch (Exception e) { last = e; Thread.Sleep(60); }
                }
                throw last;
            }
        }

        List<Dictionary<string, object>> LoadBlocks()
        {
            try { return LoadBlocksStrict(); } catch { return new List<Dictionary<string, object>>(); }
        }

        // written to a temp file first and swapped in, so the guard never reads a half-written list
        void SaveBlocks(List<Dictionary<string, object>> list)
        {
            lock (fileLock)
            {
                string tmp = BlocksPath + ".tmp";
                File.WriteAllText(tmp, js.Serialize(list), new UTF8Encoding(false));
                if (File.Exists(BlocksPath)) File.Replace(tmp, BlocksPath, null); else File.Move(tmp, BlocksPath);
            }
        }

        // read - change - write as one step, so a block added while a slow firewall check was running is not lost
        bool UpdateBlocks(Func<List<Dictionary<string, object>>, List<Dictionary<string, object>>> change)
        {
            lock (fileLock)
            {
                try { SaveBlocks(change(LoadBlocksStrict())); return true; }
                catch (Exception e) { Program.Log("blocks.json update failed: " + e.Message); return false; }
            }
        }

        static bool IsGameMode(Dictionary<string, object> b) { return b.ContainsKey("mode") && Convert.ToString(b["mode"]) == "game"; }

        // Entries whose firewall rule vanished (deleted by hand) are dropped, so the list always matches reality.
        object Blocks()
        {
            var list = LoadBlocks();
            var gone = new HashSet<string>(list.Where(b => !(Demo || IsGameMode(b) || Firewall.IsActive((string)b["ip"]))).Select(b => (string)b["ip"]));
            if (gone.Count > 0) UpdateBlocks(cur => cur.Where(b => !gone.Contains((string)b["ip"])).ToList());
            return list.Where(b => !gone.Contains((string)b["ip"])).ToList();
        }

        // Rebuilds the list from the real firewall rules named "GameNetKit block ...":
        // rules we don't know about are added (so they can always be removed), stale entries are dropped.
        object SyncBlocks()
        {
            if (Demo) return LoadBlocks();
            var targets = Firewall.ListTargets();   // slow (PowerShell): done first, then merged into the list as it is by then
            var result = new List<Dictionary<string, object>>();
            UpdateBlocks(known =>
            {
                result = new List<Dictionary<string, object>>();
                foreach (var kv in targets)
                {
                    string target = kv.Key;
                    var e = known.FirstOrDefault(b => (string)b["ip"] == target);
                    if (e == null) e = new Dictionary<string, object> { { "ip", target }, { "label", "" }, { "game", "" }, { "time", "" } };
                    e["method"] = kv.Value;
                    result.Add(e);
                }
                foreach (var b in known)
                    if (IsGameMode(b) && !result.Any(r => (string)r["ip"] == (string)b["ip"])) result.Add(b);
                return result;
            });
            return result;
        }

        // Starts "GameNetKit.exe --fw ..." elevated and waits. -1 = user declined UAC.
        int RunElevated(string fwArgs)
        {
            try
            {
                var psi = new ProcessStartInfo(exePath, fwArgs) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                using (var p = Process.Start(psi))
                {
                    if (!p.WaitForExit(60000)) return -2;
                    return p.ExitCode;
                }
            }
            catch (Win32Exception) { return -1; }
        }

        static string FwWhy(int rc) { return rc == -2 ? "timed out waiting for the admin prompt" : "exit code " + rc; }

        object Block(Dictionary<string, object> body)
        {
            string ip = Convert.ToString(body["ip"]);
            if (!Firewall.ValidIp(ip)) return Fail("bad ip");
            string protectedWhy = Firewall.Protected(ip);
            if (protectedWhy != "") return new Dictionary<string, object> { { "ok", false }, { "error", "protected" }, { "detail", protectedWhy } };
            string game = body.ContainsKey("game") ? Convert.ToString(body["game"]) : "";
            bool whilePlaying = body.ContainsKey("mode") && Convert.ToString(body["mode"]) == "game" && game != "";
            if (whilePlaying)
            {
                // the block only lives while that game runs: the guard (one admin prompt, then silent) switches it on and off
                if (!GuardRunning()) { string why = StartGuard(true); if (why != "") return Fail(why); }
                var entry0 = new Dictionary<string, object>
                {
                    { "ip", ip }, { "label", body.ContainsKey("label") ? Convert.ToString(body["label"]) : "" }, { "game", game },
                    { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) }, { "method", "" }, { "mode", "game" }
                };
                if (!UpdateBlocks(cur => { var gl = cur.Where(b => (string)b["ip"] != ip).ToList(); gl.Add(entry0); return gl; })) return Fail("busy");
                return Ok();
            }
            if (!Demo)
            {
                int rc = RunElevated("--fw block --ip " + ip);
                if (rc == -1) return Fail("uac");
                if (rc != 0) return FwFail("firewall", FwWhy(rc));
                if (!Firewall.IsActive(ip)) return FwFail("firewall", "rule was added but could not be found afterwards");
            }
            string method = Demo ? "firewall" : Firewall.MethodOf(ip);
            var entry1 = new Dictionary<string, object>
            {
                { "ip", ip },
                { "label", body.ContainsKey("label") ? Convert.ToString(body["label"]) : "" },
                { "game", body.ContainsKey("game") ? Convert.ToString(body["game"]) : "" },
                { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) },
                { "method", method }, { "mode", "always" }
            };
            if (!UpdateBlocks(cur => { var list = cur.Where(b => (string)b["ip"] != ip).ToList(); list.Add(entry1); return list; })) return Fail("busy");
            return Ok();
        }

        object Unblock(Dictionary<string, object> body)
        {
            string ip = Convert.ToString(body["ip"]);
            if (!Firewall.ValidIp(ip)) return Fail("bad ip");
            var entry = LoadBlocks().FirstOrDefault(b => (string)b["ip"] == ip);
            if (entry != null && IsGameMode(entry))
            {
                // the guard removes an applied block by itself within 2 s; with no guard running only a leftover needs an admin prompt
                UpdateBlocks(cur => cur.Where(b => (string)b["ip"] != ip).ToList());
                if (!Demo && !GuardRunning() && Firewall.IsActive(ip))
                {
                    int rc0 = RunElevated("--fw unblock --ip " + ip);
                    if (rc0 == -1) return Fail("uac");
                }
                return Ok();
            }
            if (!Demo)
            {
                int rc = RunElevated("--fw unblock --ip " + ip);
                if (rc == -1) return Fail("uac");
                if (rc != 0) return FwFail("firewall", FwWhy(rc));
            }
            UpdateBlocks(cur => cur.Where(b => (string)b["ip"] != ip).ToList());
            return Ok();
        }

        // ------------------------------------------------------------------ guard (elevated background watcher)
        object GuardState()
        {
            var st = new Dictionary<string, object> { { "running", false }, { "games", new object[0] }, { "applied", new object[0] } };
            try
            {
                if (!File.Exists(Guard.StatePath)) return st;
                var g = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(Guard.StatePath));
                DateTime t = DateTime.ParseExact(Convert.ToString(g["time"]), "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                bool fresh = (DateTime.Now - t).TotalSeconds < 9;
                bool alive = false;
                try { using (Process.GetProcessById(Convert.ToInt32(g["pid"]))) alive = true; } catch { }
                st["running"] = fresh && alive;
                st["games"] = g["running"];
                st["applied"] = g["applied"];
                st["error"] = g.ContainsKey("error") ? g["error"] : "";
                st["version"] = g.ContainsKey("version") ? g["version"] : "";
            }
            catch { }
            return st;
        }

        bool GuardRunning() { return (bool)((Dictionary<string, object>)GuardState())["running"]; }

        // starts the guard (UAC prompt, no waiting for it to end). "" = running, otherwise an error code.
        // The guard runs from a copy named GameNetKit-Guard.exe (so Task Manager tells the two parts apart). If the copy is in use
        // by a running guard it is simply kept; otherwise it is refreshed from this exe.
        string GuardLaunchPath()
        {
            try
            {
                string dir = Path.Combine(Program.DataDir, "bin");
                Directory.CreateDirectory(dir);
                string dst = Path.Combine(dir, GuardInstall.GuardFileName);
                try { File.Copy(exePath, dst, true); } catch (IOException) { }
                return File.Exists(dst) ? dst : exePath;
            }
            catch { return exePath; }
        }

        // remember = the user asked for it, so it is also started automatically the next time the app opens.
        // With the "start with Windows" task installed the guard starts silently; otherwise Windows shows its admin prompt.
        string StartGuard(bool remember)
        {
            try { File.Delete(Guard.StopPath); } catch { }
            bool started = false;
            if (!Demo && TaskInstalled() && GuardInstall.RunTask())
            {
                for (int i = 0; i < 40 && !started; i++) { if (GuardRunning()) started = true; else Thread.Sleep(250); }
            }
            if (!started)
            {
                try
                {
                    var psi = new ProcessStartInfo(GuardLaunchPath(), "--guard 1" + (Demo ? " --demo 1" : "")) { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden };
                    if (!Demo) psi.Verb = "runas";
                    Process.Start(psi);
                }
                catch (Win32Exception) { return "uac"; }
                catch { return "guard"; }
                for (int i = 0; i < 40 && !started; i++) { if (GuardRunning()) started = true; else Thread.Sleep(250); }
            }
            if (!started) return "guard";
            if (remember) Remember("guardAuto", true);
            return "";
        }

        void StopGuard()
        {
            if (!GuardRunning()) return;
            try { File.WriteAllText(Guard.StopPath, "1"); } catch { }
            for (int i = 0; i < 24 && GuardRunning(); i++) Thread.Sleep(250);
        }

        object GuardStart()
        {
            if (GuardRunning()) { Remember("guardAuto", true); return Ok(); }
            string why = StartGuard(true);
            return why == "" ? Ok() : Fail(why);
        }

        // stopping it by hand also means "do not start it by itself next time"
        object GuardStop()
        {
            StopGuard();
            Remember("guardAuto", false);
            return Ok();
        }

        // One admin prompt removes every rule this app ever created.
        object UnblockAll()
        {
            if (!Demo)
            {
                int rc = RunElevated("--fw unblockall");
                if (rc == -1) return Fail("uac");
                if (rc != 0) return FwFail("firewall", FwWhy(rc));
            }
            SaveBlocks(new List<Dictionary<string, object>>());
            return Ok();
        }

        // ------------------------------------------------------------------ history (one folder per game)
        static bool SafeId(string id) { return id != null && Regex.IsMatch(id, @"^[A-Za-z0-9_\-]{1,80}$"); }

        string SlugOf(Dictionary<string, object> body)
        {
            string game = body.ContainsKey("game") ? Convert.ToString(body["game"]) : "";
            string slug = Program.Slug(game);
            return slug;
        }

        string HistoryDirFor(string slug, string person = "") { return person == "" ? Path.Combine(HistoryRoot, slug) : Path.Combine(PeopleRoot, person, slug); }
        string ResultsDirFor(string slug) { return Path.Combine(ResultsRoot, slug); }

        Dictionary<string, object> LoadRun(string file)
        {
            try { return (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(file)); }
            catch { return null; }
        }

        object HistoryList(Dictionary<string, object> body)
        {
            string slug = SlugOf(body);
            Migrate();
            var rows = new List<Dictionary<string, object>>();
            string dir = HistoryDirFor(slug, PersonOf(body));
            if (!Directory.Exists(dir)) return rows;
            foreach (string f in Directory.GetFiles(dir, "*.json").OrderByDescending(x => x))
            {
                var run = LoadRun(f);
                if (run == null) continue;
                var results = (object[])run["results"];
                rows.Add(new Dictionary<string, object>
                {
                    { "id", run["id"] }, { "time", run["time"] }, { "game", run["game"] }, { "count", results.Length },
                    { "best", results.Length > 0 ? results[0] : null }
                });
            }
            return rows;
        }

        // number of saved scans per game name (for the tab badges)
        object HistoryCounts()
        {
            Migrate();
            var d = new Dictionary<string, object>();
            foreach (var g in Games())
            {
                string name = (string)g["name"];
                string dir = HistoryDirFor(Program.Slug(name));
                d[name] = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json").Length : 0;
            }
            return d;
        }

        object HistoryGet(Dictionary<string, object> body)
        {
            string id = Convert.ToString(body["id"]);
            if (!SafeId(id)) return Fail("bad id");
            string f = Path.Combine(HistoryDirFor(SlugOf(body), PersonOf(body)), id + ".json");
            if (!File.Exists(f)) return Fail("not found");
            return LoadRun(f);
        }

        void DeleteRun(string slug, string id)
        {
            try { File.Delete(Path.Combine(HistoryDirFor(slug), id + ".json")); } catch { }
            try { File.Delete(Path.Combine(ResultsDirFor(slug), id + ".csv")); } catch { }
        }

        object HistoryDelete(Dictionary<string, object> body)
        {
            string id = Convert.ToString(body["id"]);
            if (!SafeId(id)) return Fail("bad id");
            if (PersonOf(body) != "") { try { File.Delete(Path.Combine(HistoryDirFor(SlugOf(body), PersonOf(body)), id + ".json")); } catch { } }
            else DeleteRun(SlugOf(body), id);
            return Ok();
        }

        // clears only the selected game; other games keep their history
        object HistoryClear(Dictionary<string, object> body)
        {
            string slug = SlugOf(body);
            string person = PersonOf(body);
            if (person != "")
            {
                string pd = HistoryDirFor(slug, person);
                if (Directory.Exists(pd)) foreach (string pf in Directory.GetFiles(pd, "*.json")) { try { File.Delete(pf); } catch { } }
                return Ok();
            }
            string hd = HistoryDirFor(slug), rd = ResultsDirFor(slug);
            if (Directory.Exists(hd))
                foreach (string f in Directory.GetFiles(hd, "*.json")) DeleteRun(slug, Path.GetFileNameWithoutExtension(f));
            if (Directory.Exists(rd))
                foreach (string f in Directory.GetFiles(rd, "*.csv")) { try { File.Delete(f); } catch { } }
            return Ok();
        }

        void OpenFolder(Dictionary<string, object> body)
        {
            string dir = ResultsDirFor(SlugOf(body));
            Directory.CreateDirectory(dir);
            Process.Start("explorer.exe", "\"" + dir + "\"");
        }

        // ------------------------------------------------------------------ one-time migration of older layouts
        // v0.2 - v0.4.2 kept everything in History\*.json and Results\*.csv regardless of game. Sort them into per-game folders.
        void Migrate()
        {
            try
            {
                Directory.CreateDirectory(HistoryRoot);
                if (Directory.Exists(HistoryRoot))
                    foreach (string f in Directory.GetFiles(HistoryRoot, "*.json"))
                    {
                        var run = LoadRun(f);
                        string slug = run != null && run.ContainsKey("game") ? Program.Slug(Convert.ToString(run["game"])) : "Other";
                        string target = Path.Combine(HistoryDirFor(slug), Path.GetFileName(f));
                        Directory.CreateDirectory(HistoryDirFor(slug));
                        if (!File.Exists(target)) File.Move(f, target); else File.Delete(f);
                    }
                if (Directory.Exists(ResultsRoot))
                    foreach (string f in Directory.GetFiles(ResultsRoot, "*.csv"))
                    {
                        string name = Path.GetFileName(f);
                        string slug = Program.Slug(name.Split('_')[0]);
                        string target = Path.Combine(ResultsDirFor(slug), name);
                        Directory.CreateDirectory(ResultsDirFor(slug));
                        if (!File.Exists(target)) File.Move(f, target); else File.Delete(f);
                    }
            }
            catch { }
            ImportLegacyCsv();
        }

        // A CSV without a history entry (saved by v0.2.0 before history existed) becomes one.
        void ImportLegacyCsv()
        {
            if (!Directory.Exists(ResultsRoot)) return;
            foreach (string gdir in Directory.GetDirectories(ResultsRoot))
            {
                string slug = Path.GetFileName(gdir);
                foreach (string csv in Directory.GetFiles(gdir, "*.csv"))
                {
                    string id = Path.GetFileNameWithoutExtension(csv);
                    Directory.CreateDirectory(HistoryDirFor(slug));
                    string target = Path.Combine(HistoryDirFor(slug), id + ".json");
                    if (File.Exists(target) || !SafeId(id)) continue;
                    try
                    {
                        string[] lines = File.ReadAllLines(csv, Encoding.UTF8);
                        if (lines.Length < 2) continue;
                        string[] head = SplitCsv(lines[0]).ToArray();
                        var results = new List<Dictionary<string, object>>();
                        foreach (string line in lines.Skip(1))
                        {
                            if (string.IsNullOrWhiteSpace(line)) continue;
                            string[] c = SplitCsv(line).ToArray();
                            var row = new Dictionary<string, object>();
                            for (int i = 0; i < head.Length && i < c.Length; i++)
                            {
                                string h = head[i]; string v = c[i];
                                long n; double d;
                                if (h == "avg" || h == "max") row[h] = long.TryParse(v, out n) ? (object)n : null;
                                else if (h == "jitter") row[h] = double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out d) ? (object)d : null;
                                else if (h == "port" || h == "packets" || h == "kb" || h == "loss") row[h] = long.TryParse(v, out n) ? n : 0;
                                else row[h] = v;
                            }
                            results.Add(row);
                        }
                        var parts = id.Split('_');
                        string time = "";
                        DateTime t;
                        if (parts.Length >= 3 && DateTime.TryParseExact(parts[parts.Length - 2] + parts[parts.Length - 1], "yyyyMMddHHmmss",
                            CultureInfo.InvariantCulture, DateTimeStyles.None, out t))
                            time = t.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
                        var g = Games().FirstOrDefault(x => Program.Slug((string)x["name"]) == slug);
                        var run = new Dictionary<string, object>
                        {
                            { "id", id }, { "time", time }, { "game", g != null ? (string)g["name"] : slug }, { "results", results }
                        };
                        File.WriteAllText(target, js.Serialize(run), new UTF8Encoding(false));
                    }
                    catch { }
                }
            }
        }

        static IEnumerable<string> SplitCsv(string line)
        {
            var sb = new StringBuilder();
            bool q = false;
            for (int i = 0; i < line.Length; i++)
            {
                char ch = line[i];
                if (q)
                {
                    if (ch == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; } else q = false; }
                    else sb.Append(ch);
                }
                else if (ch == '"') q = true;
                else if (ch == ',') { yield return sb.ToString(); sb.Clear(); }
                else sb.Append(ch);
            }
            yield return sb.ToString();
        }
    }
}
