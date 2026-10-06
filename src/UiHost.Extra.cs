// UiHost part 2: blocked servers (firewall) and run history. C# 5 / .NET Framework 4.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace GameNetKit
{
    public partial class UiHost
    {
        readonly object fileLock = new object();
        bool Demo { get { return args.ContainsKey("demo"); } }
        string BlocksPath { get { return Path.Combine(Program.DataDir, Demo ? "blocks-demo.json" : "blocks.json"); } }
        string HistoryDir { get { return Path.Combine(Program.DataDir, Demo ? "History-demo" : "History"); } }
        string ResultsDir { get { return Path.Combine(Program.DataDir, Demo ? "Results-demo" : "Results"); } }

        static Dictionary<string, object> Fail(string err)
        {
            return new Dictionary<string, object> { { "ok", false }, { "error", err } };
        }

        // ------------------------------------------------------------------ blocked servers
        List<Dictionary<string, object>> LoadBlocks()
        {
            lock (fileLock)
            {
                try
                {
                    if (File.Exists(BlocksPath))
                        return ((object[])js.DeserializeObject(File.ReadAllText(BlocksPath))).Select(o => (Dictionary<string, object>)o).ToList();
                }
                catch { }
                return new List<Dictionary<string, object>>();
            }
        }

        void SaveBlocks(List<Dictionary<string, object>> list)
        {
            lock (fileLock) File.WriteAllText(BlocksPath, js.Serialize(list), new UTF8Encoding(false));
        }

        // Entries whose firewall rule vanished (deleted by hand) are dropped, so the list always matches reality.
        object Blocks()
        {
            var list = LoadBlocks();
            var keep = list.Where(b => Demo || Firewall.IsActive((string)b["ip"])).ToList();
            if (keep.Count != list.Count) SaveBlocks(keep);
            return keep;
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

        object Block(Dictionary<string, object> body)
        {
            string ip = Convert.ToString(body["ip"]);
            if (!Firewall.ValidIp(ip)) return Fail("bad ip");
            if (!Demo)
            {
                int rc = RunElevated("--fw block --ip " + ip);
                if (rc == -1) return Fail("uac");
                if (rc != 0) return Fail("firewall");
                if (!Firewall.IsActive(ip)) return Fail("firewall");
            }
            var list = LoadBlocks().Where(b => (string)b["ip"] != ip).ToList();
            list.Add(new Dictionary<string, object>
            {
                { "ip", ip },
                { "label", body.ContainsKey("label") ? Convert.ToString(body["label"]) : "" },
                { "game", body.ContainsKey("game") ? Convert.ToString(body["game"]) : "" },
                { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) }
            });
            SaveBlocks(list);
            return Ok();
        }

        object Unblock(Dictionary<string, object> body)
        {
            string ip = Convert.ToString(body["ip"]);
            if (!Firewall.ValidIp(ip)) return Fail("bad ip");
            if (!Demo)
            {
                int rc = RunElevated("--fw unblock --ip " + ip);
                if (rc == -1) return Fail("uac");
                if (rc != 0) return Fail("firewall");
            }
            SaveBlocks(LoadBlocks().Where(b => (string)b["ip"] != ip).ToList());
            return Ok();
        }

        // ------------------------------------------------------------------ history
        static bool SafeId(string id) { return id != null && Regex.IsMatch(id, @"^[A-Za-z0-9_\-]{1,80}$"); }

        Dictionary<string, object> LoadRun(string file)
        {
            try { return (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(file)); }
            catch { return null; }
        }

        object HistoryList()
        {
            ImportLegacyCsv();
            var rows = new List<Dictionary<string, object>>();
            if (!Directory.Exists(HistoryDir)) return rows;
            foreach (string f in Directory.GetFiles(HistoryDir, "*.json").OrderByDescending(x => x))
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

        object HistoryGet(Dictionary<string, object> body)
        {
            string id = Convert.ToString(body["id"]);
            if (!SafeId(id)) return Fail("bad id");
            string f = Path.Combine(HistoryDir, id + ".json");
            if (!File.Exists(f)) return Fail("not found");
            return LoadRun(f);
        }

        void DeleteRun(string id)
        {
            try { File.Delete(Path.Combine(HistoryDir, id + ".json")); } catch { }
            try { File.Delete(Path.Combine(ResultsDir, id + ".csv")); } catch { }
        }

        object HistoryDelete(Dictionary<string, object> body)
        {
            string id = Convert.ToString(body["id"]);
            if (!SafeId(id)) return Fail("bad id");
            DeleteRun(id);
            return Ok();
        }

        // Writes every saved run into one JSON file (server IPs and ping numbers only) and shows it in Explorer.
        object HistoryExport()
        {
            ImportLegacyCsv();
            var runs = new List<object>();
            if (Directory.Exists(HistoryDir))
                foreach (string f in Directory.GetFiles(HistoryDir, "*.json").OrderBy(x => x))
                {
                    var run = LoadRun(f);
                    if (run != null) runs.Add(run);
                }
            string dir = Path.Combine(Program.DataDir, "Exports");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "GameNetKit_history_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".json");
            var doc = new Dictionary<string, object>
            {
                { "app", "GameNetKit" }, { "version", Program.Version },
                { "exported", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) }, { "runs", runs }
            };
            File.WriteAllText(path, js.Serialize(doc), new UTF8Encoding(false));
            if (!Demo) { try { Process.Start("explorer.exe", "/select,\"" + path + "\""); } catch { } }
            return new Dictionary<string, object> { { "ok", true }, { "path", path }, { "count", runs.Count } };
        }

        object HistoryClear()
        {
            if (Directory.Exists(HistoryDir))
                foreach (string f in Directory.GetFiles(HistoryDir, "*.json")) DeleteRun(Path.GetFileNameWithoutExtension(f));
            if (Directory.Exists(ResultsDir))
                foreach (string f in Directory.GetFiles(ResultsDir, "*.csv")) { try { File.Delete(f); } catch { } }
            return Ok();
        }

        // Results saved by v0.2.0 as CSV only: bring them into the history once.
        void ImportLegacyCsv()
        {
            if (!Directory.Exists(ResultsDir)) return;
            Directory.CreateDirectory(HistoryDir);
            foreach (string csv in Directory.GetFiles(ResultsDir, "*.csv"))
            {
                string id = Path.GetFileNameWithoutExtension(csv);
                string target = Path.Combine(HistoryDir, id + ".json");
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
                    string prefix = parts[0];
                    var g = Games().FirstOrDefault(x => Regex.Replace((string)x["name"], "[^A-Za-z0-9]", "") == prefix);
                    var run = new Dictionary<string, object>
                    {
                        { "id", id }, { "time", time }, { "game", g != null ? (string)g["name"] : prefix }, { "results", results }
                    };
                    File.WriteAllText(target, js.Serialize(run), new UTF8Encoding(false));
                }
                catch { }
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
