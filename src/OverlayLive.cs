// The overlay's content for GameNetKit: a live ping to the game server of the latest scan, shown over the game, and its keyboard shortcut.
//   - the server is the first (busiest) one of the newest scan in History, so a scan has to have been made once
//   - servers that answer ping are pinged once a second; servers that do not (many cloud ones) are measured through their cloud region
//     (the same method and the same "≈" caveat as in the scan)
// Runs only while the window is open (the notification-area icon's thread owns the shortcut and the panel).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GameNetKit
{
    public static class OverlayLive
    {
        public const string DefaultKey = "Ctrl+Alt+P";
        const int WM_HOTKEY = 0x0312, HotkeyId = 77;
        const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;

        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);

        // texts from the window (in its language); English until the window has sent them
        public static readonly Dictionary<string, string> Labels = new Dictionary<string, string>
        {
            { "ovPing", "Ping" }, { "ovJitter", "Jitter" }, { "ovLoss", "Loss" }, { "ovNone", "Run a scan first" },
            { "ovHudHint", "Press the shortcut again for commands" }, { "ovMenuHint", "Press a number or click · Esc closes" },
            { "ovCmdScan", "New scan" }, { "ovCmdBlock", "Block this server while playing" }, { "ovCmdUnblock", "Unblock this server" }, { "ovCmdUnblockAll", "Remove all blocks" },
            { "ovDone", "Done" }, { "ovBusy", "A scan is already running" }, { "ovUac", "Needs admin approval" }, { "ovFail", "Could not do it" }
        };
        public static string L(string k) { string v; return Labels.TryGetValue(k, out v) && v != "" ? v : k; }
        public static void SetLabel(string k, string v) { if (k.StartsWith("ov") && v != null && v.Length <= 120) Labels[k] = v; Overlay.StatusHint = L("ovHudHint"); Overlay.MenuHint = L("ovMenuHint"); }

        /// <summary>the commands of the menu (set by the window host)</summary>
        public static Func<List<OverlayItem>> Commands;
        public static string CurrentIp { get { lock (gate) { return ip; } } }
        public static string CurrentGame { get { lock (gate) { return game; } } }
        public static string CurrentPlace { get { lock (gate) { return place; } } }

        class HotWin : NativeWindow
        {
            public HotWin() { CreateHandle(new CreateParams()); }
            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_HOTKEY && (int)m.WParam == HotkeyId) Toggle();
                base.WndProc(ref m);
            }
        }

        static HotWin win;
        static bool keyOn;

        // ------------------------------------------------------------------ UI thread (the tray's)
        public static void Attach()
        {
            win = new HotWin();
            Overlay.Hidden = Stop; Overlay.Init(Content);
        }

        public static void Detach()
        {
            try { Stop(); Overlay.Dispose(); if (win != null) { if (keyOn) UnregisterHotKey(win.Handle, HotkeyId); win.DestroyHandle(); } } catch { }
        }

        public static void Toggle() { Overlay.Cycle(); if (Overlay.Visible) Start(); else Stop(); }

        public static void SetVisible(bool on)
        {
            Overlay.SetVisible(on);
            if (on) Start(); else Stop();
        }

        /// <summary>registers the shortcut ("" = none). Returns "" when done, else bad / needmod / taken</summary>
        public static string SetKey(string text)
        {
            if (win == null) return "error";
            if (keyOn) { UnregisterHotKey(win.Handle, HotkeyId); keyOn = false; }
            if (string.IsNullOrWhiteSpace(text)) return "";
            uint mods, vk;
            if (!Parse(text, out mods, out vk)) return "bad";
            if (mods == 0 && !(vk >= 0x70 && vk <= 0x87)) return "needmod";       // a bare letter would steal typing: only F-keys may stand alone
            if (!RegisterHotKey(win.Handle, HotkeyId, mods | MOD_NOREPEAT, vk)) return "taken";
            keyOn = true;
            return "";
        }

        public static bool Parse(string text, out uint mods, out uint vk)
        {
            mods = 0; vk = 0;
            if (string.IsNullOrWhiteSpace(text)) return false;
            string key = null;
            foreach (string part in text.Split('+'))
            {
                string p = part.Trim();
                if (p == "") continue;
                if (p.Equals("Ctrl", StringComparison.OrdinalIgnoreCase)) mods |= MOD_CONTROL;
                else if (p.Equals("Alt", StringComparison.OrdinalIgnoreCase)) mods |= MOD_ALT;
                else if (p.Equals("Shift", StringComparison.OrdinalIgnoreCase)) mods |= MOD_SHIFT;
                else if (p.Equals("Win", StringComparison.OrdinalIgnoreCase)) mods |= MOD_WIN;
                else key = p;
            }
            if (key == null) return false;
            vk = VkOf(key);
            return vk != 0;
        }

        static uint VkOf(string k)
        {
            if (k.Length == 1 && k[0] >= 'A' && k[0] <= 'Z') return k[0];
            if (k.Length == 1 && k[0] >= 'a' && k[0] <= 'z') return (uint)char.ToUpper(k[0]);
            if (k.Length == 1 && k[0] >= '0' && k[0] <= '9') return k[0];
            int n;
            if (k.Length >= 2 && (k[0] == 'F' || k[0] == 'f') && int.TryParse(k.Substring(1), out n) && n >= 1 && n <= 24) return (uint)(0x70 + n - 1);
            if (k.StartsWith("Numpad", StringComparison.OrdinalIgnoreCase) && int.TryParse(k.Substring(6), out n) && n >= 0 && n <= 9) return (uint)(0x60 + n);
            switch (k.ToLowerInvariant())
            {
                case "space": return 0x20; case "home": return 0x24; case "end": return 0x23; case "pageup": return 0x21; case "pagedown": return 0x22;
                case "insert": return 0x2D; case "delete": return 0x2E; case "up": return 0x26; case "down": return 0x28; case "left": return 0x25; case "right": return 0x27;
                case "tab": return 0x09; case "enter": return 0x0D; case "backspace": return 0x08; case "pause": return 0x13;
                case "numpadadd": return 0x6B; case "numpadsubtract": return 0x6D; case "numpadmultiply": return 0x6A; case "numpaddivide": return 0x6F; case "numpaddecimal": return 0x6E;
                case "minus": return 0xBD; case "equal": return 0xBB; case "comma": return 0xBC; case "period": return 0xBE; case "slash": return 0xBF;
                case "semicolon": return 0xBA; case "quote": return 0xDE; case "bracketleft": return 0xDB; case "bracketright": return 0xDD; case "backslash": return 0xDC; case "backquote": return 0xC0;
            }
            return 0;
        }

        // ------------------------------------------------------------------ what is shown
        static readonly Color Good = Color.FromArgb(52, 211, 153), Okay = Color.FromArgb(245, 166, 35), Bad = Color.FromArgb(239, 83, 80), Grey = Color.FromArgb(150, 162, 182);
        static readonly object gate = new object();
        static string ip = "", game = "", place = "", via = "";
        static DateTime targetAt = DateTime.MinValue;
        static readonly List<int> samples = new List<int>();         // ms, -1 = lost; the last 20
        static Analyzer.PingStat regionStat;
        static Thread th;
        static volatile bool run;

        static OverlayContent Content()
        {
            var res = new OverlayContent { Title = "GAMENETKIT" };
            var lines = res.Lines;
            try { if (Commands != null) res.Items = Commands(); } catch (Exception e) { Program.Log("overlay commands: " + e.Message); }
            string title = "GAMENETKIT";
            lock (gate)
            {
                if (ip == "") { lines.Add(new OverlayLine(L("ovNone"), Grey)); return res; }
                title = (game != "" ? game : "GameNetKit").ToUpperInvariant();
                var st = Current();
                if (st == null) { lines.Add(new OverlayLine("…", Grey)); }
                else
                {
                    string v = st.Avg == null ? "bad" : Analyzer.Verdict(st);
                    Color c = v == "good" ? Good : v == "ok" ? Okay : Bad;
                    string ms = st.Avg == null ? "—" : (via != "" ? "≈ " : "") + st.Avg + " ms";
                    lines.Add(new OverlayLine(L("ovPing") + "   " + Ltr(ms), c));
                    lines.Add(new OverlayLine(L("ovJitter") + "   " + Ltr(st.Jitter.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " ms"), Grey));
                    lines.Add(new OverlayLine(L("ovLoss") + "   " + Ltr(st.Loss + "%"), st.Loss >= 3 ? Bad : Grey));
                }
                if (place != "") lines.Add(new OverlayLine(place, Grey));
            }
            res.Title = title;
            return res;
        }

        // numbers and units keep their reading order inside an Arabic line (25 ms, not ms 25)
        static string Ltr(string s) { return "‪" + s + "‬"; }

        static Analyzer.PingStat Current()
        {
            if (via != "") return regionStat;
            if (samples.Count == 0) return null;
            var ok = samples.Where(x => x >= 0).ToList();
            var r = new Analyzer.PingStat { Loss = samples.Count < 5 ? 0 : (int)Math.Round(100.0 * (samples.Count - ok.Count) / samples.Count) };   // no verdict on loss from a handful of packets
            if (ok.Count == 0) return r;
            r.Avg = (int)Math.Round(ok.Average());
            r.Max = ok.Max();
            double sum = 0; for (int i = 1; i < ok.Count; i++) sum += Math.Abs(ok[i] - ok[i - 1]);
            r.Jitter = ok.Count > 1 ? Math.Round(sum / (ok.Count - 1), 1) : 0;
            return r;
        }

        // ------------------------------------------------------------------ the measuring thread (runs only while the panel is visible)
        static void Start()
        {
            if (run) return;
            run = true;
            th = new Thread(Loop) { IsBackground = true, Name = "overlay-ping" };
            th.Start();
        }

        static void Stop() { run = false; }

        static void Loop()
        {
            using (var ping = new Ping())
            {
                while (run)
                {
                    try
                    {
                        if ((DateTime.Now - targetAt).TotalSeconds > 15) FindTarget();
                        string target, region;
                        lock (gate) { target = ip; region = via; }
                        if (target == "") { Thread.Sleep(1000); continue; }
                        if (region == "")
                        {
                            int ms = -1;
                            try { var r = ping.Send(target, 900); if (r != null && r.Status == IPStatus.Success) ms = (int)Math.Max(1, r.RoundtripTime); } catch { }
                            lock (gate) { if (ip == target) { samples.Add(ms); if (samples.Count > 20) samples.RemoveAt(0); } }
                            Thread.Sleep(900);
                        }
                        else
                        {
                            var rg = Analyzer.RegionOf(target);
                            var st = rg == null ? null : Analyzer.MeasureRegion(rg, 5);
                            lock (gate) { if (ip == target) regionStat = st ?? new Analyzer.PingStat { Loss = 100 }; }
                            Thread.Sleep(1500);
                        }
                    }
                    catch (Exception e) { Program.Log("overlay ping: " + e.Message); Thread.Sleep(2000); }
                }
            }
        }

        /// <summary>the server of the newest saved scan (its busiest server)</summary>
        static void FindTarget()
        {
            targetAt = DateTime.Now;
            try
            {
                string root = Path.Combine(Program.DataDir, "History");
                if (!Directory.Exists(root)) return;
                string newest = null; DateTime when = DateTime.MinValue;
                foreach (string dir in Directory.GetDirectories(root))
                    foreach (string f in Directory.GetFiles(dir, "*.json"))
                    {
                        DateTime t = File.GetLastWriteTime(f);
                        if (t > when) { when = t; newest = f; }
                    }
                if (newest == null) return;
                var js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
                var run0 = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(newest));
                var results = run0.ContainsKey("results") ? run0["results"] as object[] : null;
                if (results == null || results.Length == 0) return;
                var s = (Dictionary<string, object>)results[0];
                string nip = Convert.ToString(s["ip"]);
                string where = string.Join(" · ", new[] { s.ContainsKey("country") ? Convert.ToString(s["country"]) : "", s.ContainsKey("city") ? Convert.ToString(s["city"]) : "" }.Where(x => x != "" && x != "?"));
                lock (gate)
                {
                    if (nip != ip) { samples.Clear(); regionStat = null; }
                    ip = nip; game = run0.ContainsKey("game") ? Convert.ToString(run0["game"]) : ""; place = where;
                    via = s.ContainsKey("via") && s["via"] != null ? Convert.ToString(s["via"]) : "";
                }
            }
            catch (Exception e) { Program.Log("overlay target: " + e.Message); }
        }
    }
}
