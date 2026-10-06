// Elevated worker: waits for the game, captures UDP headers with pktmon, measures servers, writes state.json.
// Runs as a separate (admin) process so the UI itself never needs elevation.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace GameNetKit
{
    public static class Worker
    {
        static readonly JavaScriptSerializer Js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static string dir, game = "", error = "", errorCode = "", csvPath = "";
        static int totalSeconds, secondsLeft, portCount;
        static List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();

        class Cancelled : Exception { }
        class Fail : Exception
        {
            public string Code;
            public Fail(string code, string msg) : base(msg) { Code = code; }
        }

        static void Put(string phase)
        {
            var st = new Dictionary<string, object>
            {
                { "phase", phase }, { "game", game }, { "secondsLeft", secondsLeft }, { "totalSeconds", totalSeconds },
                { "ports", portCount }, { "error", error }, { "errorCode", errorCode }, { "results", results }, { "csvPath", csvPath }
            };
            string path = Path.Combine(dir, "state.json");
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, Js.Serialize(st), new UTF8Encoding(false));
            File.Copy(tmp, path, true);
        }

        static bool CancelRequested() { return File.Exists(Path.Combine(dir, "cancel.flag")); }
        static void CheckCancel() { if (CancelRequested()) throw new Cancelled(); }

        public static int Run(Dictionary<string, string> a)
        {
            dir = a["dir"];
            game = a.ContainsKey("game") ? a["game"] : "";
            string proc = a.ContainsKey("process") ? a["process"].Replace(".exe", "") : "";
            totalSeconds = a.ContainsKey("seconds") ? int.Parse(a["seconds"]) : 240;
            int top = a.ContainsKey("top") ? int.Parse(a["top"]) : 8;
            int pings = a.ContainsKey("pings") ? int.Parse(a["pings"]) : 10;
            bool demo = a.ContainsKey("demo");
            demoMode = demo;
            Directory.CreateDirectory(dir);
            try
            {
                if (demo) RunDemo(); else RunReal(proc, top, pings);
                return 0;
            }
            catch (Cancelled) { errorCode = "cancelled"; error = ""; Put("error"); return 0; }
            catch (Fail f) { errorCode = f.Code; error = f.Message; Put("error"); return 1; }
            catch (Exception e) { errorCode = "generic"; error = e.Message; Put("error"); return 1; }
        }

        // ------------------------------------------------------------------ real capture
        static int Pktmon(string args, out string output)
        {
            var psi = new ProcessStartInfo("pktmon.exe", args)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var p = Process.Start(psi))
            {
                string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                output = o;
                return p.ExitCode;
            }
        }

        static void RunReal(string proc, int top, int pings)
        {
            secondsLeft = totalSeconds;
            Put("waiting_game");
            while (Process.GetProcessesByName(proc).Length == 0) { CheckCancel(); Thread.Sleep(1000); }

            Put("ready");
            string goFlag = Path.Combine(dir, "go.flag");
            while (!File.Exists(goFlag)) { CheckCancel(); Thread.Sleep(500); }

            string etl = Path.Combine(Path.GetTempPath(), "gamenetkit_cap.etl");
            string txt = Path.Combine(Path.GetTempPath(), "gamenetkit_cap.txt");
            try { File.Delete(etl); File.Delete(txt); } catch { }

            var ports = new HashSet<int>();
            string o;
            Pktmon("stop", out o);
            Pktmon("filter remove", out o);
            if (Pktmon("filter add GameUDP -t UDP", out o) != 0) throw new Fail("capture", "filter: " + o.Trim());
            if (Pktmon("start --capture --comp nics --pkt-size 128 --file-name \"" + etl + "\" --file-size 300", out o) != 0)
                throw new Fail("capture", "start: " + o.Trim());

            try
            {
                DateTime end = DateTime.Now.AddSeconds(totalSeconds);
                int tick = 0;
                while (DateTime.Now < end)
                {
                    CheckCancel();
                    if (tick % 2 == 0)
                    {
                        var pids = new HashSet<int>(Process.GetProcessesByName(proc).Select(p => p.Id));
                        Analyzer.CollectUdpPorts(pids, ports);
                    }
                    secondsLeft = (int)Math.Ceiling((end - DateTime.Now).TotalSeconds);
                    portCount = ports.Count;
                    Put("capturing");
                    tick++;
                    Thread.Sleep(1000);
                }
            }
            finally
            {
                Pktmon("stop", out o);
                Pktmon("filter remove", out o);
            }

            secondsLeft = 0;
            Put("analyzing");
            if (Pktmon("etl2txt \"" + etl + "\" --out \"" + txt + "\"", out o) != 0 || !File.Exists(txt))
                throw new Fail("capture", "etl2txt: " + o.Trim());

            long parsed;
            List<Srv> servers = Analyzer.ParseCapture(File.ReadLines(txt), ports, out parsed);
            if (servers.Count == 0)
            {
                string resDir = Path.Combine(dir, "Results");
                Directory.CreateDirectory(resDir);
                try { File.Copy(txt, Path.Combine(resDir, "debug_capture.txt"), true); } catch { }
                throw new Fail("nodata", "lines=" + parsed + ", ports=" + ports.Count + " (debug_capture.txt saved in Results)");
            }

            Put("measuring");
            Measure(servers.Take(top).ToList(), pings);
        }

        static void Measure(List<Srv> list, int pings)
        {
            var geo = Analyzer.Geo(list.Select(s => s.Ip));
            var rows = new Dictionary<string, Dictionary<string, object>>();
            var tasks = list.Select(s => Task.Factory.StartNew(() =>
            {
                var ps = Analyzer.MeasurePing(s.Ip, pings);
                Dictionary<string, object> g;
                geo.TryGetValue(s.Ip, out g);
                var row = new Dictionary<string, object>
                {
                    { "ip", s.Ip }, { "port", s.Port }, { "packets", s.Packets }, { "kb", (long)Math.Round(s.Bytes / 1024.0) },
                    { "country", g != null ? (string)g["country"] : "?" },
                    { "city", g != null ? (string)g["city"] : "?" },
                    { "provider", g != null ? (string)g["isp"] : "?" },
                    { "host", Analyzer.Ptr(s.Ip) },
                    { "avg", ps.Avg }, { "max", ps.Max }, { "jitter", ps.Jitter }, { "loss", ps.Loss },
                    { "verdict", Analyzer.Verdict(ps) }
                };
                lock (rows) rows[s.Ip] = row;
            })).ToArray();
            Task.WaitAll(tasks);
            results = list.Select(s => rows[s.Ip]).ToList();
            WriteCsv();
            Put("done");
        }

        static bool demoMode;

        // Saves the finished run as a history entry (id = csv file name) so the UI can list and delete it later.
        static void SaveHistory()
        {
            string histDir = Path.Combine(dir, demoMode ? "History-demo" : "History");
            Directory.CreateDirectory(histDir);
            string id = Path.GetFileNameWithoutExtension(csvPath);
            var run = new Dictionary<string, object>
            {
                { "id", id }, { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm", System.Globalization.CultureInfo.InvariantCulture) },
                { "game", game }, { "results", results }
            };
            File.WriteAllText(Path.Combine(histDir, id + ".json"), Js.Serialize(run), new UTF8Encoding(false));
        }

        static void WriteCsv()
        {
            string resDir = Path.Combine(dir, demoMode ? "Results-demo" : "Results");
            Directory.CreateDirectory(resDir);
            string safe = new string(game.Where(char.IsLetterOrDigit).ToArray());
            csvPath = Path.Combine(resDir, safe + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".csv");
            string[] cols = { "ip", "port", "country", "city", "provider", "host", "packets", "kb", "avg", "max", "jitter", "loss", "verdict" };
            var sb = new StringBuilder();
            sb.AppendLine(string.Join(",", cols));
            foreach (var r in results)
                sb.AppendLine(string.Join(",", cols.Select(c => "\"" + Convert.ToString(r[c] ?? "", System.Globalization.CultureInfo.InvariantCulture).Replace("\"", "\"\"") + "\"")));
            File.WriteAllText(csvPath, sb.ToString(), new UTF8Encoding(true));
            SaveHistory();
        }

        // ------------------------------------------------------------------ demo (UI testing without admin / game)
        static void RunDemo()
        {
            totalSeconds = 8; secondsLeft = totalSeconds;
            Put("waiting_game");
            for (int i = 0; i < 3; i++) { CheckCancel(); Thread.Sleep(1000); }
            Put("ready");
            string goFlag = Path.Combine(dir, "go.flag");
            while (!File.Exists(goFlag)) { CheckCancel(); Thread.Sleep(300); }
            for (int s = totalSeconds; s > 0; s--)
            {
                CheckCancel();
                secondsLeft = s; portCount = Math.Min(4, totalSeconds - s + 1);
                Put("capturing");
                Thread.Sleep(1000);
            }
            secondsLeft = 0;
            Put("analyzing"); Thread.Sleep(1200);
            Put("measuring"); Thread.Sleep(1200);
            results = new List<Dictionary<string, object>>
            {
                Demo("203.0.113.10", 7777, "Bahrain", "Manama", "Amazon", 8421, 612, 31, 3, 0, "good"),
                Demo("203.0.113.55", 7778, "Germany", "Frankfurt", "Amazon", 1204, 98, 142, 33, 4, "bad"),
                Demo("198.51.100.7", 7777, "India", "Mumbai", "Amazon", 640, 52, 87, 12, 0, "ok"),
                Demo("198.51.100.90", 443, "United States", "Ashburn", "Epic Games", 120, 9, null, null, 100, "noreply")
            };
            WriteCsv();
            Put("done");
        }

        static Dictionary<string, object> Demo(string ip, int port, string country, string city, string isp, long pk, long kb, int? avg, double? jit, int loss, string verdict)
        {
            return new Dictionary<string, object>
            {
                { "ip", ip }, { "port", port }, { "country", country }, { "city", city }, { "provider", isp }, { "host", "" },
                { "packets", pk }, { "kb", kb }, { "avg", avg }, { "max", avg == null ? (int?)null : avg + 9 }, { "jitter", jit }, { "loss", loss }, { "verdict", verdict }
            };
        }
    }
}
