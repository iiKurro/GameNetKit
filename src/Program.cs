// GameNetKit - UI host. Serves the embedded web UI on 127.0.0.1 and opens it in an app-style window (Edge).
// Everything that needs admin runs in a separate worker process started on demand (UAC prompt). C# 5 / .NET Framework 4.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GameNetKit
{
    public static class Program
    {
        public static string Version = "0.9.0";   // --fakeversion x.y.z overrides it (used only to test the update flow)
        public const string Repo = "iiKurro/GameNetKit";

        public static string DataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GameNetKit");
        public static bool DemoMode;

        // folder-safe name of a game: "Rocket League" -> "RocketLeague"
        public static string Slug(string game)
        {
            string s = System.Text.RegularExpressions.Regex.Replace(game ?? "", "[^A-Za-z0-9]", "");
            return s == "" ? "Other" : s;
        }

        [STAThread]
        public static int Main(string[] argv)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            // anything that escapes ends up in app-log.txt, so a crash or a vanished window can be explained afterwards
            AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
            {
                Log("UNHANDLED " + (e.ExceptionObject is Exception ? ((Exception)e.ExceptionObject).ToString() : Convert.ToString(e.ExceptionObject)));
            };
            var args = ParseArgs(argv);
            if (args.ContainsKey("fakeversion")) Version = args["fakeversion"];
            // demo runs live in their own folder so they can never touch real results, blocks or a running instance
            if (args.ContainsKey("demo") && !args.ContainsKey("worker") && !args.ContainsKey("fw")) { DemoMode = true; DataDir = Path.Combine(DataDir, "demo-data"); }
            if (args.ContainsKey("worker")) return Worker.Run(args);
            if (args.ContainsKey("fw")) return Firewall.Run(args);
            if (args.ContainsKey("guard")) return Guard.Run();
            if (args.ContainsKey("install-guard")) return GuardInstall.Install(args);
            if (args.ContainsKey("uninstall-guard")) return GuardInstall.Uninstall();
            if (args.ContainsKey("selftest")) return SelfTest();
            return new UiHost(args).Run();
        }

        static readonly object logLock = new object();

        public static void Log(string line)
        {
            try
            {
                lock (logLock)
                {
                    Directory.CreateDirectory(DataDir);
                    string p = Path.Combine(DataDir, "app-log.txt");
                    if (File.Exists(p) && new FileInfo(p).Length > 200 * 1024) File.Delete(p);   // keep it small
                    File.AppendAllText(p, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " v" + Version + " " + line + Environment.NewLine);
                }
            }
            catch { }
        }

        public static Dictionary<string, string> ParseArgs(string[] argv)
        {
            var d = new Dictionary<string, string>();
            for (int i = 0; i < argv.Length; i++)
            {
                if (!argv[i].StartsWith("--")) continue;
                string k = argv[i].Substring(2);
                if (i + 1 < argv.Length && !argv[i + 1].StartsWith("--")) { d[k] = argv[i + 1]; i++; }
                else d[k] = "1";
            }
            return d;
        }

        // Headless check of parser + ping + geo; writes selftest.txt to the data dir.
        static int SelfTest()
        {
            Directory.CreateDirectory(DataDir);
            var sb = new StringBuilder();
            var ports = new HashSet<int> { 54321 };
            string[] sample =
            {
                "\t 192.168.1.5.54321 > 8.8.8.8.7777: UDP, length 58",
                "\t 8.8.8.8.7777 > 192.168.1.5.54321: UDP, length 120",
                "\t 192.168.1.5.54321 > 1.1.1.1.7777: UDP, length 40",
                "\t 192.168.1.5.60000 > 9.9.9.9.53: UDP, length 40",
                "\t 192.168.1.5.54321 > 192.168.1.1.53: UDP, length 40",
                "\t 2a02:6b8:1::5.54321 > 2a00:1450:4009::65.7777: UDP, length 80",
                "\t 2a00:1450:4009::65.7777 > 2a02:6b8:1::5.54321: UDP, length 120",
                "\t fe80::1.54321 > ff02::fb.5353: UDP, length 40",
                "\t 2a02:6b8:1::5.54321 > fd00::9.7777: UDP, length 40"
            };
            long parsed;
            var list = Analyzer.ParseCapture(sample, ports, out parsed);
            sb.AppendLine("parsed=" + parsed + " servers=" + list.Count + " first=" + (list.Count > 0 ? list[0].Ip + "/" + list[0].Packets : "-"));
            var geo = Analyzer.Geo(list.Select(s => s.Ip));
            foreach (var s in list)
            {
                var p = Analyzer.MeasurePing(s.Ip, 3);
                sb.AppendLine(s.Ip + " avg=" + p.Avg + " loss=" + p.Loss + " verdict=" + Analyzer.Verdict(p) +
                    " geo=" + (geo.ContainsKey(s.Ip) ? (string)geo[s.Ip]["country"] : "?"));
            }
            sb.AppendLine("udp ports of this process: " + CountPorts());
            File.WriteAllText(Path.Combine(DataDir, "selftest.txt"), sb.ToString());
            return 0;
        }

        static int CountPorts()
        {
            var into = new HashSet<int>();
            Analyzer.CollectUdpPorts(new HashSet<int>(Process.GetProcesses().Select(p => p.Id)), into);
            return into.Count;
        }
    }

    public partial class UiHost
    {
        readonly Dictionary<string, string> args;
        readonly JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        readonly string token = NewToken();
        readonly string statePath = Path.Combine(Program.DataDir, "state.json");
        HttpListener listener;
        int port;
        string exePath;
        string html;
        DateTime lastBeat = DateTime.Now;
        bool seenBeat;
        Process worker;
        Process browserProc;
        // last update check
        string latestTag = "", assetUrl = "", notes = "";
        bool hasUpdate;

        public UiHost(Dictionary<string, string> a) { args = a; }

        static string NewToken()
        {
            var b = new byte[16];
            using (var r = RandomNumberGenerator.Create()) r.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        public int Run()
        {
            exePath = Process.GetCurrentProcess().MainModule.FileName;
            Directory.CreateDirectory(Program.DataDir);

            bool created;
            using (var mutex = new Mutex(true, Program.DemoMode ? "GameNetKit.SingleInstance.Demo" : "GameNetKit.SingleInstance", out created))
            {
                if (!created)
                {
                    // another instance is running: just bring up its window
                    try
                    {
                        string[] pf = File.ReadAllText(Path.Combine(Program.DataDir, "port.txt")).Split('|');
                        OpenWindow("http://127.0.0.1:" + pf[0] + "/?t=" + pf[1]);
                    }
                    catch { }
                    return 0;
                }

                try { File.Delete(statePath); } catch { }
                ClearFlags();
                html = LoadHtml();
                StartListener();
                File.WriteAllText(Path.Combine(Program.DataDir, "port.txt"), port + "|" + token);
                var thread = new Thread(Serve) { IsBackground = true };
                thread.Start();

                // remembered choice: the guard comes back by itself (silently with the sign-in task, otherwise with Windows' admin prompt)
                if (Setting("guardAuto"))
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(2500);
                        try { if (!GuardRunning()) { string why = StartGuard(false); if (why != "") Program.Log("guard auto-start failed: " + why); } }
                        catch (Exception e) { Program.Log("guard auto-start error: " + e.Message); }
                    });

                // windows left over from an earlier run still point at a dead server (that is the "frozen window"): close them first
                bool useWindow = !args.ContainsKey("nowindow");
                if (useWindow) KillStaleWindows();
                Process browser = useWindow ? OpenWindow("http://127.0.0.1:" + port + "/?t=" + token) : null;
                browserProc = browser;
                DateTime started = DateTime.Now;
                DateTime lastWindowSeen = DateTime.Now;
                DateTime nextCheck = DateTime.Now.AddSeconds(5);
                string reason = "";

                // The server lives as long as its window does. The window is found by its private profile folder, NOT through the
                // process we started: msedge.exe often hands the window to another process and exits at once, which used to make
                // the server quit while the window was still open. A missed heartbeat (sleep, minimized, throttled timers) no longer ends it.
                while (true)
                {
                    Thread.Sleep(1000);
                    bool busy = IsWorkerBusy();
                    if (useWindow && DateTime.Now >= nextCheck)
                    {
                        nextCheck = DateTime.Now.AddSeconds(5);
                        if (WindowAlive()) lastWindowSeen = DateTime.Now;
                    }
                    bool windowGone = useWindow && (DateTime.Now - started).TotalSeconds > 45 && (DateTime.Now - lastWindowSeen).TotalSeconds > 20;
                    if (!busy)
                    {
                        if (windowGone) { reason = "window closed"; break; }
                        if (!useWindow)
                        {
                            if (seenBeat && (DateTime.Now - lastBeat).TotalSeconds > 120) { reason = "no heartbeat"; break; }
                            if (!seenBeat && (DateTime.Now - started).TotalSeconds > 90) { reason = "nothing connected"; break; }
                        }
                    }
                    else if (windowGone)
                    {
                        // user closed the window in the middle of a run: stop the worker
                        try { File.WriteAllText(Path.Combine(Program.DataDir, "cancel.flag"), "1"); } catch { }
                        Thread.Sleep(3000);
                        reason = "window closed during a scan";
                        break;
                    }
                }
                Program.Log("server stopped: " + reason);
                // "background" off = nothing may keep running once the window is gone, so the guard goes too (and comes back next time if it is remembered)
                if (!Setting("background")) { StopGuard(); Program.Log("guard stopped because background mode is off"); }
                try { listener.Stop(); } catch { }
                try { File.Delete(Path.Combine(Program.DataDir, "port.txt")); } catch { }
            }
            return 0;
        }

        static bool SafeExited(Process p) { try { return p.HasExited; } catch { return true; } }

        void ClearFlags()
        {
            foreach (string f in new[] { "go.flag", "cancel.flag" })
                try { File.Delete(Path.Combine(Program.DataDir, f)); } catch { }
        }

        string LoadHtml()
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var s = asm.GetManifestResourceStream("ui.html"))
            using (var r = new StreamReader(s, Encoding.UTF8))
                return r.ReadToEnd();
        }

        void StartListener()
        {
            var rnd = new Random();
            for (int i = 0; i < 30; i++)
            {
                port = rnd.Next(20000, 60000);
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                try { listener.Start(); return; }
                catch (HttpListenerException) { listener.Close(); }
            }
            throw new InvalidOperationException("no free port");
        }

        // ------------------------------------------------------------------ window
        Process OpenWindow(string url)
        {
            string[] candidates =
            {
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", @"Google\Chrome\Application\chrome.exe")
            };
            string browser = candidates.FirstOrDefault(File.Exists);
            try
            {
                if (browser != null)
                {
                    string profile = Path.Combine(Program.DataDir, "window");
                    string a = "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=1120,800 --no-first-run --no-default-browser-check" +
                               " --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
                    return Process.Start(new ProcessStartInfo(browser, a) { UseShellExecute = false });
                }
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
            return null;
        }

        // ------------------------------------------------------------------ http
        void Serve()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                // a network hiccup while accepting must not end the loop for good (that would leave a server that never answers again)
                try { ctx = listener.GetContext(); }
                catch (Exception e)
                {
                    if (!listener.IsListening) return;
                    Program.Log("accept failed, continuing: " + e.Message);
                    Thread.Sleep(100);
                    continue;
                }
                ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
            }
        }

        void Handle(HttpListenerContext ctx)
        {
            try
            {
                string path = ctx.Request.Url.AbsolutePath;
                // DNS-rebinding guard: only our own host header
                if (ctx.Request.Headers["Host"] != "127.0.0.1:" + port) { Send(ctx, 403, "text/plain", "forbidden"); return; }

                if (path == "/")
                {
                    if (ctx.Request.QueryString["t"] != token) { Send(ctx, 403, "text/plain", "forbidden"); return; }
                    string page = html.Replace("<head>", "<head><script>window.__TOKEN__=\"" + token + "\";</script>");
                    Send(ctx, 200, "text/html; charset=utf-8", page);
                    return;
                }
                if (!path.StartsWith("/api/") || ctx.Request.Headers["X-Token"] != token) { Send(ctx, 403, "text/plain", "forbidden"); return; }

                object result;
                switch (path)
                {
                    case "/api/info": result = Info(); break;
                    case "/api/state": result = ReadState(); break;
                    case "/api/start": result = Start(ReadBody(ctx)); break;
                    case "/api/begin": File.WriteAllText(Path.Combine(Program.DataDir, "go.flag"), "1"); result = Ok(); break;
                    case "/api/cancel": File.WriteAllText(Path.Combine(Program.DataDir, "cancel.flag"), "1"); result = Ok(); break;
                    case "/api/reset": try { File.Delete(statePath); } catch { } ClearFlags(); result = Ok(); break;
                    case "/api/openfolder": OpenFolder(ReadBody(ctx)); result = Ok(); break;
                    case "/api/heartbeat": seenBeat = true; lastBeat = DateTime.Now; result = Ok(); break;
                    case "/api/profile": result = ProfileGet(); break;
                    case "/api/profile/set": result = ProfileSet(ReadBody(ctx)); break;
                    case "/api/people": result = PeopleList(); break;
                    case "/api/people/import": result = PeopleImport(ReadBody(ctx)); break;
                    case "/api/people/delete": result = PeopleDelete(ReadBody(ctx)); break;
                    case "/api/history/exportall": result = HistoryExportAll(); break;
                    case "/api/opendata": OpenData(); result = Ok(); break;
                    case "/api/blocks": result = Blocks(); break;
                    case "/api/blocks/sync": result = SyncBlocks(); break;
                    case "/api/settings": result = SettingsGet(); break;
                    case "/api/settings/set": result = SettingsSet(ReadBody(ctx)); break;
                    case "/api/guard/update": result = GuardInstallUpdate(); break;
                    case "/api/guard": result = GuardState(); break;
                    case "/api/guard/start": result = GuardStart(); break;
                    case "/api/guard/stop": result = GuardStop(); break;
                    case "/api/unblockall": result = UnblockAll(); break;
                    case "/api/block": result = Block(ReadBody(ctx)); break;
                    case "/api/unblock": result = Unblock(ReadBody(ctx)); break;
                    case "/api/history": result = HistoryList(ReadBody(ctx)); break;
                    case "/api/history/counts": result = HistoryCounts(); break;
                    case "/api/history/get": result = HistoryGet(ReadBody(ctx)); break;
                    case "/api/history/delete": result = HistoryDelete(ReadBody(ctx)); break;
                    case "/api/history/clear": result = HistoryClear(ReadBody(ctx)); break;
                    case "/api/history/export": result = HistoryExport(ReadBody(ctx)); break;
                    case "/api/update/check": result = CheckUpdate(); break;
                    case "/api/update/apply": result = ApplyUpdate(); break;
                    default: Send(ctx, 404, "text/plain", "not found"); return;
                }
                Send(ctx, 200, "application/json; charset=utf-8", js.Serialize(result));
            }
            catch (Exception e)
            {
                try { Send(ctx, 500, "application/json", js.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", e.Message } })); } catch { }
            }
        }

        static void Send(HttpListenerContext ctx, int code, string type, string body)
        {
            byte[] b = Encoding.UTF8.GetBytes(body);
            ctx.Response.StatusCode = code;
            ctx.Response.ContentType = type;
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.ContentLength64 = b.Length;
            ctx.Response.OutputStream.Write(b, 0, b.Length);
            ctx.Response.Close();
        }

        Dictionary<string, object> ReadBody(HttpListenerContext ctx)
        {
            using (var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
            {
                string s = r.ReadToEnd();
                if (string.IsNullOrWhiteSpace(s)) return new Dictionary<string, object>();
                return (Dictionary<string, object>)js.DeserializeObject(s);
            }
        }

        static Dictionary<string, object> Ok() { return new Dictionary<string, object> { { "ok", true } }; }

        // ------------------------------------------------------------------ games / config
        List<Dictionary<string, object>> Games()
        {
            return GameList.Load(Path.GetDirectoryName(exePath), js);
        }

        int Cfg(string key, int def)
        {
            string p = Path.Combine(Path.GetDirectoryName(exePath), "config.json");
            try
            {
                if (File.Exists(p))
                {
                    var d = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(p));
                    if (d.ContainsKey(key)) return Convert.ToInt32(d[key]);
                }
            }
            catch { }
            return def;
        }

        Dictionary<string, object> Info()
        {
            return new Dictionary<string, object> { { "version", Program.Version }, { "repo", Program.Repo }, { "games", Games() }, { "dataDir", Program.DataDir } };
        }

        // ------------------------------------------------------------------ run control
        bool IsWorkerBusy()
        {
            string ph = (string)ReadState()["phase"];
            return ph != "idle" && ph != "done" && ph != "error";
        }

        Dictionary<string, object> ReadState()
        {
            Dictionary<string, object> st = null;
            for (int i = 0; i < 3 && st == null; i++)
            {
                try
                {
                    if (File.Exists(statePath))
                        st = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(statePath));
                }
                catch { Thread.Sleep(30); }
            }
            if (st == null) return EmptyState("idle", "", "");
            string ph = (string)st["phase"];
            // worker died without reporting
            if (worker != null && SafeExited(worker) && ph != "done" && ph != "error" && ph != "idle" && ph != "elevating")
                return EmptyState("error", "generic", "worker exited unexpectedly");
            return st;
        }

        static Dictionary<string, object> EmptyState(string phase, string code, string err)
        {
            return new Dictionary<string, object>
            {
                { "phase", phase }, { "game", "" }, { "secondsLeft", 0 }, { "totalSeconds", 0 }, { "ports", 0 },
                { "error", err }, { "errorCode", code }, { "results", new object[0] }, { "csvPath", "" }
            };
        }

        void WriteState(string phase, string code, string err, string game)
        {
            var st = EmptyState(phase, code, err);
            st["game"] = game;
            File.WriteAllText(statePath, js.Serialize(st), new UTF8Encoding(false));
        }

        Dictionary<string, object> Start(Dictionary<string, object> body)
        {
            if (IsWorkerBusy()) return new Dictionary<string, object> { { "ok", false }, { "error", "busy" } };
            string gameName = Convert.ToString(body["game"]);
            var g = Games().FirstOrDefault(x => (string)x["name"] == gameName);
            if (g == null) return new Dictionary<string, object> { { "ok", false }, { "error", "unknown game" } };

            ClearFlags();
            bool demo = args.ContainsKey("demo");
            WriteState("elevating", "", "", gameName);

            string a = "--worker 1 --dir \"" + Program.DataDir + "\" --game \"" + gameName + "\" --process \"" + g["process"] + "\"" +
                       " --seconds " + Cfg("captureSeconds", 240) + " --top " + Cfg("topServers", 8) + " --pings " + Cfg("pingCount", 10) +
                       (demo ? " --demo 1" : "");

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    var psi = new ProcessStartInfo(exePath, a) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exePath) };
                    if (!demo) psi.Verb = "runas";
                    worker = Process.Start(psi);
                }
                catch (Win32Exception)
                {
                    WriteState("error", "uac", "", gameName);
                }
                catch (Exception e)
                {
                    WriteState("error", "generic", e.Message, gameName);
                }
            });
            return Ok();
        }

        // ------------------------------------------------------------------ updates (GitHub releases)
        Dictionary<string, object> CheckUpdate()
        {
            var res = new Dictionary<string, object>
            {
                { "current", Program.Version }, { "latest", "" }, { "hasUpdate", false }, { "notes", "" }, { "error", "" }
            };
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("https://api.github.com/repos/" + Program.Repo + "/releases/latest");
                req.UserAgent = "GameNetKit/" + Program.Version;
                req.Accept = "application/vnd.github+json";
                req.Timeout = 10000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    var rel = (Dictionary<string, object>)js.DeserializeObject(sr.ReadToEnd());
                    string tag = Convert.ToString(rel["tag_name"]);
                    string ver = tag.TrimStart('v', 'V');
                    latestTag = ver;
                    notes = rel.ContainsKey("body") && rel["body"] != null ? Convert.ToString(rel["body"]) : "";
                    assetUrl = "";
                    foreach (object o in (object[])rel["assets"])
                    {
                        var asset = (Dictionary<string, object>)o;
                        if (string.Equals((string)asset["name"], "GameNetKit.exe", StringComparison.OrdinalIgnoreCase))
                            assetUrl = (string)asset["browser_download_url"];
                    }
                    hasUpdate = assetUrl != "" && new Version(ver) > new Version(Program.Version);
                    res["latest"] = ver;
                    res["hasUpdate"] = hasUpdate;
                    res["notes"] = notes.Length > 400 ? notes.Substring(0, 400) : notes;
                }
            }
            catch (Exception e) { res["error"] = e.Message; }
            return res;
        }

        // Downloads the new exe next to the current one, then swaps it in after this process exits.
        Dictionary<string, object> ApplyUpdate()
        {
            if (!hasUpdate || string.IsNullOrEmpty(assetUrl) || !assetUrl.StartsWith("https://github.com/" + Program.Repo + "/"))
                return new Dictionary<string, object> { { "ok", false }, { "error", "no update" } };
            StopGuard();
            if (GuardRunning()) return new Dictionary<string, object> { { "ok", false }, { "error", "guard running" } };
            string tmp = exePath + ".new";
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(assetUrl);
                req.UserAgent = "GameNetKit/" + Program.Version;
                req.Timeout = 60000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var rs = resp.GetResponseStream())
                using (var fs = File.Create(tmp))
                    rs.CopyTo(fs);
                var fi = new FileInfo(tmp);
                bool valid = fi.Length > 20000;
                using (var fs = File.OpenRead(tmp)) valid = valid && fs.ReadByte() == 'M' && fs.ReadByte() == 'Z';
                if (!valid) { File.Delete(tmp); return new Dictionary<string, object> { { "ok", false }, { "error", "bad download" } }; }

                string cmd = "/c ping 127.0.0.1 -n 3 >nul & move /y \"" + tmp + "\" \"" + exePath + "\" >nul & start \"\" \"" + exePath + "\"";
                Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false });
                // close this window too, so the updated app replaces it instead of leaving a dead one behind
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Thread.Sleep(700);
                    try { if (browserProc != null && !browserProc.HasExited) browserProc.Kill(); } catch { }
                    Environment.Exit(0);
                });
                return Ok();
            }
            catch (Exception e)
            {
                try { File.Delete(tmp); } catch { }
                return new Dictionary<string, object> { { "ok", false }, { "error", e.Message } };
            }
        }
    }
}
