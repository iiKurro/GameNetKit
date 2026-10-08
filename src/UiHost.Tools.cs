// UiHost part 7: notifications, the "copy diagnostics" text, and what the notification-area icon can ask the window to do.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace GameNetKit
{
    public partial class UiHost
    {
        // the window asks for a Windows notification (it only does when the window is not the active one); sound follows a setting
        object Notify(Dictionary<string, object> body)
        {
            if (!Setting("notify")) return Ok();
            string title = body.ContainsKey("title") ? Convert.ToString(body["title"]) : "GameNetKit";
            string text = body.ContainsKey("text") ? Convert.ToString(body["text"]) : "";
            if (title.Length > 80) title = title.Substring(0, 80);
            if (text.Length > 240) text = text.Substring(0, 240);
            Tray.Notify(title, text, Setting("sound"));
            return Ok();
        }

        // free text from a scan (a provider name): no control or markup characters, at most 60 characters
        static string CleanLabel(string s)
        {
            s = System.Text.RegularExpressions.Regex.Replace(s ?? "", @"[\p{C}<>""'\\/:*?|]", "").Trim();
            return s.Length > 60 ? s.Substring(0, 60).Trim() : s;
        }

        object TrayLabels(Dictionary<string, object> body)
        {
            Func<string, string> g = k => body.ContainsKey(k) ? Convert.ToString(body[k]) : "";
            Tray.SetLabels(g("open"), g("guardOn"), g("guardOff"), g("exit"));
            foreach (var k in body.Keys.ToList()) if (k.StartsWith("ov")) OverlayLive.SetLabel(k, g(k));
            return Ok();
        }

        // tray menu: "open" brings the window back, "exit" closes the window and the app
        void TrayOpen()
        {
            try
            {
                if (WebHost.Active) WebHost.Bring();
                else if (!FocusExistingWindow()) OpenWindow("http://127.0.0.1:" + port + "/?t=" + token);
            }
            catch (Exception e) { Program.Log("tray open: " + e.Message); }
        }

        void TrayExit()
        {
            try { if (!IsWorkerBusy()) StopGuardIfNotBackground(); } catch { }
            try { KillStaleWindows(); } catch { }
            Program.Log("exit from the tray icon");
            Tray.Stop();
            Environment.Exit(0);
        }

        void StopGuardIfNotBackground() { if (!Setting("background")) StopGuard(); }

        // ------------------------------------------------------------------ "the game is running but the app does not see it"
        static readonly HashSet<string> NotGames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "chrome", "msedge", "firefox", "opera", "brave", "discord", "steam", "steamwebhelper", "claude", "code", "obs64", "explorer", "searchhost",
            "textinputhost", "applicationframehost", "systemsettings", "shellexperiencehost", "startmenuexperiencehost", "runtimebroker", "dwm", "ctfmon",
            "svchost", "system", "idle", "gamenetkit", "gamenetkit-guard", "teams", "ms-teams", "spotify", "whatsapp", "telegram", "epicgameslauncher",
            "battle.net", "agent", "ea", "eadesktop", "origin", "ubisoftconnect", "upc", "riotclientservices", "riotclientux", "goxlr app", "overwolf"
        };

        // running programs that could be the game: they own UDP ports (a game in a match always does) or a window, biggest first
        object Processes()
        {
            var udp = Analyzer.UdpCountsByPid();
            var rows = new List<Dictionary<string, object>>();
            int me = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == me || NotGames.Contains(p.ProcessName)) continue;
                    int ports; udp.TryGetValue(p.Id, out ports);
                    string title = "";
                    try { title = p.MainWindowTitle ?? ""; } catch { }
                    if (ports == 0 && title == "") continue;
                    int mb = (int)(p.WorkingSet64 / (1024 * 1024));
                    if (mb < 60) continue;
                    int score = (ports > 0 ? 100 : 0) + (title != "" ? 30 : 0) + Math.Min(mb / 100, 60);
                    rows.Add(new Dictionary<string, object>
                    {
                        { "name", p.ProcessName + ".exe" }, { "title", title.Length > 80 ? title.Substring(0, 80) : title }, { "mb", mb }, { "udp", ports }, { "score", score }
                    });
                }
                catch { }
                finally { p.Dispose(); }
            }
            var top = rows.OrderByDescending(r => (int)r["score"]).Take(14).ToList();
            // the likely one: owns several UDP ports, has a window and a game-sized memory footprint
            var best = top.FirstOrDefault(r => (int)r["udp"] >= 2 && Convert.ToString(r["title"]) != "" && (int)r["mb"] >= 800);
            foreach (var r in top) r["suggested"] = ReferenceEquals(r, best);
            return top;
        }

        // remembers "this program is that game": the scan, the guard and the list all use it from now on
        object AddGameProcess(Dictionary<string, object> body)
        {
            string game = body.ContainsKey("game") ? Convert.ToString(body["game"]) : "";
            string proc = body.ContainsKey("process") ? Convert.ToString(body["process"]).Trim() : "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(proc, @"^[A-Za-z0-9_.\- ]{1,64}$")) return Fail("bad process");
            if (!proc.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) proc += ".exe";
            if (!Games().Any(g => (string)g["name"] == game)) return Fail("unknown game");
            lock (fileLock)
            {
                var ov = new Dictionary<string, object>();
                try { if (File.Exists(GameList.OverridesPath)) ov = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(GameList.OverridesPath)); } catch { }
                string have = ov.ContainsKey(game) ? Convert.ToString(ov[game]) : "";
                if (!have.Split('|').Any(x => string.Equals(x, proc, StringComparison.OrdinalIgnoreCase))) ov[game] = have == "" ? proc : have + "|" + proc;
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(GameList.OverridesPath, js.Serialize(ov), new System.Text.UTF8Encoding(false));
            }
            Program.Log("game process added: " + game + " -> " + proc);
            return Ok();
        }

        // ------------------------------------------------------------------ diagnostics (for "copy diagnostics")
        static string Tail(string path, int lines)
        {
            try
            {
                if (!File.Exists(path)) return "(none)";
                var all = File.ReadAllLines(path);
                return string.Join("\n", all.Skip(Math.Max(0, all.Length - lines)));
            }
            catch (Exception e) { return "(unreadable: " + e.Message + ")"; }
        }

        // Everything a person helping you would ask for, and nothing private: no group code, admin code, secrets or password.
        object Diagnostics()
        {
            var sb = new StringBuilder();
            sb.AppendLine("GameNetKit " + Program.Version + "  " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("Windows: " + Environment.OSVersion.VersionString + (Environment.Is64BitOperatingSystem ? " (64-bit)" : " (32-bit)") + "  .NET: " + Environment.Version);
            sb.AppendLine("Exe: " + exePath);
            sb.AppendLine("Data: " + Program.DataDir);
            sb.AppendLine();
            sb.AppendLine("== Settings ==");
            var s = ReadSettings();
            foreach (var kv in s) sb.AppendLine(kv.Key + " = " + kv.Value);
            sb.AppendLine("taskInstalled = " + TaskInstalled() + ", startupEntry = " + StartupEntry.Exists() + ", startupDisabledByUser = " + StartupEntry.DisabledByUser());
            sb.AppendLine();
            sb.AppendLine("== Guard ==");
            var gs = (Dictionary<string, object>)GuardState();
            sb.AppendLine("running = " + gs["running"] + ", version = " + (gs.ContainsKey("version") ? gs["version"] : "") + ", error = " + (gs.ContainsKey("error") ? gs["error"] : ""));
            sb.AppendLine("applied = " + string.Join(", ", ((IEnumerable<object>)gs["applied"]).Select(o => Convert.ToString(o))));
            sb.AppendLine();
            sb.AppendLine("== Sharing ==");
            var sy = (Dictionary<string, object>)SyncState();
            foreach (string k in new[] { "configured", "hasCode", "enabled", "hasPassword", "error", "lastOkSecondsAgo", "players", "uploaded" }) sb.AppendLine(k + " = " + sy[k]);
            sb.AppendLine();
            sb.AppendLine("== Games ==");
            foreach (var g in Games()) sb.AppendLine(g["name"] + "  [" + g["process"] + "]  running=" + GameList.IsRunning(Convert.ToString(g["process"])));
            sb.AppendLine();
            sb.AppendLine("== Blocks ==");
            foreach (var b in LoadBlocks()) sb.AppendLine(b["ip"] + "  " + (b.ContainsKey("mode") ? b["mode"] : "") + "  " + (b.ContainsKey("game") ? b["game"] : "") + "  " + (b.ContainsKey("method") ? b["method"] : ""));
            sb.AppendLine();
            sb.AppendLine("== Last scan state ==");
            var st = ReadState();
            sb.AppendLine("phase = " + st["phase"] + ", game = " + st["game"] + ", errorCode = " + st["errorCode"] + ", error = " + st["error"]);
            sb.AppendLine();
            sb.AppendLine("== app-log (last 30) ==\n" + Tail(Path.Combine(Program.DataDir, "app-log.txt"), 30));
            sb.AppendLine("\n== fw-log (last 30) ==\n" + Tail(Firewall.LogPath, 30));
            sb.AppendLine("\n== guard-log (last 30) ==\n" + Tail(Path.Combine(Program.DataDir, "guard-log.txt"), 30));
            sb.AppendLine("\n== install-log (last 15) ==\n" + Tail(Path.Combine(Program.DataDir, "install-log.txt"), 15));
            return new Dictionary<string, object> { { "ok", true }, { "text", sb.ToString() } };
        }
    }
}
