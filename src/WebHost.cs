// The app's own window. The page is shown inside a GameNetKit window (the WebView2 engine that ships with Windows 11 and Edge), so the taskbar,
// Alt+Tab and Task Manager say "GameNetKit" with its own icon, and the title bar is ours (it follows the light / dark theme of the page).
// If WebView2 is missing or fails to start, the program falls back to the old way: an Edge / Chrome "app" window.
//
// The two managed WebView2 files are embedded in the exe and loaded from there; the small native loader is unpacked next to the data
// (webview2\WebView2Loader.dll) and loaded by full path, so nothing has to be installed or sit beside the exe.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GameNetKit
{
    // everything that does not touch the WebView2 types, so it is safe to call before they can be loaded
    public static class WebHost
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string path);

        static bool hooked, loaderReady;
        static string lastError = "";
        public static string LastError { get { return lastError; } }
        public static bool Active { get; private set; }
        public static Action Fallback;                      // set by the app: what to do when the engine fails to start
        public static void RequestFallback() { var f = Fallback; if (f != null) f(); }

        /// <summary>lets the exe supply its embedded copies of the WebView2 assemblies</summary>
        public static void Hook()
        {
            if (hooked) return;
            hooked = true;
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                try
                {
                    string name = new AssemblyName(e.Name).Name;
                    if (!name.StartsWith("Microsoft.Web.WebView2", StringComparison.Ordinal)) return null;
                    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream(name + ".dll"))
                    {
                        if (st == null) return null;
                        var bytes = new byte[st.Length];
                        int read = 0; while (read < bytes.Length) { int n = st.Read(bytes, read, bytes.Length - read); if (n <= 0) break; read += n; }
                        return Assembly.Load(bytes);
                    }
                }
                catch { return null; }
            };
        }

        static bool UnpackLoader()
        {
            if (loaderReady) return true;
            try
            {
                string res = Environment.Is64BitProcess ? "WebView2Loader.x64.dll" : "WebView2Loader.x86.dll";
                string dir = Path.Combine(Program.DataDir, "webview2", Environment.Is64BitProcess ? "x64" : "x86");
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "WebView2Loader.dll");
                using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream(res))
                {
                    if (st == null) { lastError = "loader not embedded"; return false; }
                    if (!File.Exists(path) || new FileInfo(path).Length != st.Length)
                    {
                        try { using (var f = File.Create(path)) st.CopyTo(f); }
                        catch (IOException) { if (!File.Exists(path)) throw; }       // another copy of the app has it loaded: it is the same file
                    }
                }
                loaderReady = LoadLibrary(path) != IntPtr.Zero;
                if (!loaderReady) lastError = "loader would not load";
                return loaderReady;
            }
            catch (Exception e) { lastError = "loader: " + e.Message; return false; }
        }

        /// <summary>true when the WebView2 engine can be used on this PC</summary>
        public static bool Available()
        {
            Hook();
            if (!UnpackLoader()) return false;
            try { return Probe(); }
            catch (Exception e) { lastError = "webview2: " + e.Message; return false; }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static bool Probe()
        {
            string v = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrEmpty(v)) { lastError = "no WebView2 runtime"; return false; }
            return true;
        }

        /// <summary>shows the window and runs its message loop on the calling (main) thread until it is closed</summary>
        public static void Run(string url, Action closed)
        {
            RunCore(url, closed);
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static void RunCore(string url, Action closed)
        {
            Active = true;
            var form = new WebWindow(url, closed);
            window = form;
            Application.Run(form);
            Active = false;
        }

        static WebWindow window;

        public static void Bring() { var w = window; if (w != null) w.BringForward(); }
        public static void Quit() { var w = window; if (w != null) w.CloseFromOutside(); }
    }

    public class WebWindow : Form
    {
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);

        readonly string url;
        readonly Action closed;
        Microsoft.Web.WebView2.WinForms.WebView2 web;
        Color caption = Color.FromArgb(11, 14, 20), ink = Color.FromArgb(232, 237, 243);
        bool dark = true;
        bool quitting;

        public WebWindow(string startUrl, Action onClosed)
        {
            url = startUrl; closed = onClosed;
            Text = "GameNetKit";
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = caption;
            MinimumSize = new Size(900, 640);
            try { Icon = Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName); } catch { }
            StartPosition = FormStartPosition.Manual;
            Size = new Size(1180, 820);
            RestoreBounds();

            web = new Microsoft.Web.WebView2.WinForms.WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = caption };
            Controls.Add(web);
            Load += async (s, e) => { try { await StartWeb(); } catch (Exception ex) { Program.Log("webview2 start: " + ex.Message); FallBack(); } };
            FormClosing += (s, e) => SaveBounds();
            FormClosed += (s, e) => { try { if (closed != null) closed(); } catch { } if (!quitting) Application.ExitThread(); };
        }

        // ------------------------------------------------------------------ the engine
        async System.Threading.Tasks.Task StartWeb()
        {
            var options = new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions(
                "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=msSmartScreenProtection");
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "webview"), options);
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            var st = core.Settings;
            st.AreDevToolsEnabled = false; st.IsStatusBarEnabled = false; st.IsZoomControlEnabled = false; st.IsSwipeNavigationEnabled = false;
            st.IsPasswordAutosaveEnabled = false; st.IsGeneralAutofillEnabled = false; st.IsPinchZoomEnabled = false; st.AreBrowserAcceleratorKeysEnabled = true;
            st.IsBuiltInErrorPageEnabled = false;
            core.ContextMenuRequested += OnContextMenu;
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenOutside(e.Uri); };
            core.NavigationStarting += (s, e) => { if (!IsOurs(e.Uri)) { e.Cancel = true; OpenOutside(e.Uri); } };
            core.WebMessageReceived += OnMessage;
            core.ProcessFailed += (s, e) => { Program.Log("webview2 process failed: " + e.ProcessFailedKind); try { BeginInvoke(new Action(() => { try { web.Reload(); } catch { } })); } catch { } };
            core.Navigate(url);
        }

        bool IsOurs(string uri)
        {
            try { return new Uri(uri).Authority == new Uri(url).Authority || uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        static void OpenOutside(string uri)
        {
            try { if (uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
            catch (Exception e) { Program.Log("open link: " + e.Message); }
        }

        // only the editing commands survive in the right-click menu (no "Save as", "Print", "Inspect"...)
        void OnContextMenu(object sender, Microsoft.Web.WebView2.Core.CoreWebView2ContextMenuRequestedEventArgs e)
        {
            var keep = new HashSet<string> { "cut", "copy", "paste", "selectAll" };
            var items = e.MenuItems;
            for (int i = items.Count - 1; i >= 0; i--)
                if (!keep.Contains(items[i].Name)) items.RemoveAt(i);
            if (items.Count == 0) e.Handled = true;
        }

        // the page tells the window its colours: {"type":"theme","dark":true,"bg":"#0b0e14","fg":"#e8edf3"}
        void OnMessage(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(e.WebMessageAsJson);
                if (Convert.ToString(d["type"]) != "theme") return;
                dark = Convert.ToBoolean(d["dark"]);
                caption = ParseColor(Convert.ToString(d["bg"]), caption);
                ink = ParseColor(Convert.ToString(d["fg"]), ink);
                BackColor = caption; web.DefaultBackgroundColor = caption;
                ApplyTitleBar();
            }
            catch (Exception ex) { Program.Log("theme message: " + ex.Message); }
        }

        static Color ParseColor(string s, Color fallback)
        {
            try { if (s != null && s.Length == 7 && s[0] == '#') return Color.FromArgb(Convert.ToInt32(s.Substring(1, 2), 16), Convert.ToInt32(s.Substring(3, 2), 16), Convert.ToInt32(s.Substring(5, 2), 16)); }
            catch { }
            return fallback;
        }

        // Windows 11: dark / light title bar in the page's own colours (older Windows keeps its normal bar)
        void ApplyTitleBar()
        {
            if (!IsHandleCreated) return;
            try
            {
                int on = dark ? 1 : 0;
                DwmSetWindowAttribute(Handle, 20, ref on, 4);                                   // dark mode
                int cap = caption.R | (caption.G << 8) | (caption.B << 16);
                int txt = ink.R | (ink.G << 8) | (ink.B << 16);
                DwmSetWindowAttribute(Handle, 35, ref cap, 4);                                  // caption colour
                DwmSetWindowAttribute(Handle, 36, ref txt, 4);                                  // caption text
                DwmSetWindowAttribute(Handle, 34, ref cap, 4);                                  // border
            }
            catch { }
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ApplyTitleBar(); }

        // ------------------------------------------------------------------ position
        string BoundsPath { get { return Path.Combine(Program.DataDir, "window.json"); } }

        void RestoreBounds()
        {
            try
            {
                if (File.Exists(BoundsPath))
                {
                    var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(BoundsPath));
                    var r = new Rectangle(Convert.ToInt32(d["x"]), Convert.ToInt32(d["y"]), Convert.ToInt32(d["w"]), Convert.ToInt32(d["h"]));
                    foreach (var sc in Screen.AllScreens)
                        if (sc.WorkingArea.Contains(new Point(r.X + 80, r.Y + 20)) && r.Width >= 900 && r.Height >= 640) { Bounds = r; if (d.ContainsKey("max") && Convert.ToBoolean(d["max"])) WindowState = FormWindowState.Maximized; return; }
                }
            }
            catch { }
            var wa = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1180, wa.Width - 80), Math.Min(820, wa.Height - 60));
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + (wa.Height - Height) / 2);
        }

        void SaveBounds()
        {
            try
            {
                var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBoundsRect();
                File.WriteAllText(BoundsPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "x", r.X }, { "y", r.Y }, { "w", r.Width }, { "h", r.Height }, { "max", WindowState == FormWindowState.Maximized } }));
            }
            catch { }
        }

        Rectangle RestoreBoundsRect() { return base.RestoreBounds; }

        // ------------------------------------------------------------------ from the rest of the app
        public void BringForward()
        {
            try
            {
                BeginInvoke(new Action(() =>
                {
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Show(); Activate(); TopMost = true; TopMost = false; SetForegroundWindow(Handle);
                }));
            }
            catch { }
        }

        public void CloseFromOutside()
        {
            quitting = true;
            try { BeginInvoke(new Action(() => { SaveBounds(); Application.ExitThread(); Close(); })); } catch { }
        }

        // the engine could not start: open the page in Edge / Chrome instead, and keep the app alive until that window is gone
        void FallBack()
        {
            WebHost.RequestFallback();
            quitting = true;
            try { BeginInvoke(new Action(() => { Application.ExitThread(); Close(); })); } catch { }
        }
    }
}
