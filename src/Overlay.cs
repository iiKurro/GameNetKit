// A small always-on-top panel that sits over the game. It never takes the keyboard focus.
//   status mode  click-through: the mouse passes through it, it only shows information
//   menu mode    a short numbered list of commands: press the number (works even when the game hides the mouse) or click the row;
//                Esc or the overlay shortcut closes it. The number keys are taken only while the menu is open.
// It is a normal window, so it shows over games running in a window or "borderless windowed" mode (not over exclusive fullscreen).
// Everything here runs on the UI thread (the one with the tray icon and the shortcut window).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace GameNetKit
{
    public class OverlayLine
    {
        public string Text; public Color Color;
        public OverlayLine(string text, Color color) { Text = text; Color = color; }
    }

    public class OverlayItem
    {
        public string Text; public Color Color; public Action Click;
        public OverlayItem(string text, Color color, Action click) { Text = text; Color = color; Click = click; }
    }

    public class OverlayContent
    {
        public string Title = "";
        public List<OverlayLine> Lines = new List<OverlayLine>();
        public List<OverlayItem> Items = new List<OverlayItem>();      // the commands (menu mode); at most 9
    }

    public class OverlayForm : Form
    {
        const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOPMOST = 0x8;
        const int GWL_EXSTYLE = -20, WM_HOTKEY = 0x0312, WM_MOUSEACTIVATE = 0x21;
        const uint MOD_NOREPEAT = 0x4000;
        const int KeyBase = 201, EscId = 210;           // hotkey ids: 201..209 = the number keys 1..9
        static readonly Color Panel = Color.FromArgb(14, 18, 26), Edge = Color.FromArgb(58, 70, 90), Muted = Color.FromArgb(150, 162, 182), Hover = Color.FromArgb(32, 42, 58);

        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);

        OverlayContent content = new OverlayContent();
        string corner = "tr", hint = "", status = "";
        bool menu; int hover = -1; bool keysOn;
        readonly List<Rectangle> rows = new List<Rectangle>();
        readonly Font fTitle = new Font("Segoe UI", 9f, FontStyle.Bold), fBody = new Font("Segoe UI", 11f, FontStyle.Bold), fSmall = new Font("Segoe UI", 8.5f, FontStyle.Regular);
        public Action<int> OnItem;                     // index of the command picked (key or click)
        public Action OnEscape;

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; TopMost = true;
            AutoScaleMode = AutoScaleMode.None; BackColor = Panel; Opacity = 0.93; DoubleBuffered = true;
            Size = new Size(200, 60);
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOPMOST; return cp; }
        }
        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_MOUSEACTIVATE) { m.Result = (IntPtr)3; return; }          // clicking never takes the focus from the game
            if (m.Msg == WM_HOTKEY)
            {
                int id = (int)m.WParam;
                if (id == EscId) { if (OnEscape != null) OnEscape(); }
                else if (id >= KeyBase && id < KeyBase + 9 && OnItem != null) OnItem(id - KeyBase);
                return;
            }
            base.WndProc(ref m);
        }

        static TextFormatFlags Flags(string s)
        {
            var f = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.Left;
            foreach (char c in s) if (c >= 0x0600 && c <= 0x06FF) { f |= TextFormatFlags.RightToLeft; break; }
            return f;
        }

        void ClickThrough(bool on)
        {
            if (!IsHandleCreated) return;
            int ex = GetWindowLong(Handle, GWL_EXSTYLE);
            SetWindowLong(Handle, GWL_EXSTYLE, on ? (ex | WS_EX_TRANSPARENT) : (ex & ~WS_EX_TRANSPARENT));
        }

        /// <summary>number keys 1..count and Esc belong to the menu while it is open</summary>
        void HoldKeys(bool on, int count)
        {
            if (keysOn) { for (int i = 0; i < 9; i++) UnregisterHotKey(Handle, KeyBase + i); UnregisterHotKey(Handle, EscId); keysOn = false; }
            if (!on) return;
            for (int i = 0; i < count && i < 9; i++) RegisterHotKey(Handle, KeyBase + i, MOD_NOREPEAT, (uint)('1' + i));
            RegisterHotKey(Handle, EscId, MOD_NOREPEAT, 0x1B);
            keysOn = true;
        }

        /// <summary>sets what the panel says and where it sits ("tl", "tr", "bl", "br"), then resizes and moves it</summary>
        public void Set(OverlayContent c, string newCorner, bool asMenu, string newHint, string newStatus)
        {
            bool modeChanged = asMenu != menu;
            bool countChanged = asMenu && c.Items.Count != content.Items.Count;
            content = c; corner = newCorner; menu = asMenu; hint = newHint; status = newStatus;
            if (modeChanged || countChanged) { ClickThrough(!asMenu); HoldKeys(asMenu, c.Items.Count); hover = -1; }

            int w = TextRenderer.MeasureText(c.Title, fTitle, new Size(1000, 100), TextFormatFlags.NoPadding).Width, h = 32;
            foreach (var l in c.Lines) { w = Math.Max(w, Measure(l.Text, fBody)); h += 24; }
            rows.Clear();
            if (menu && c.Items.Count > 0)
            {
                h += 6;
                foreach (var it in c.Items) { w = Math.Max(w, Measure(it.Text, fBody) + 12); rows.Add(new Rectangle(0, h, 0, 30)); h += 30; }
            }
            if (status != "") { w = Math.Max(w, Measure(status, fBody)); h += 26; }
            if (hint != "") { w = Math.Max(w, Measure(hint, fSmall)); h += 22; }
            w += 36; h += 10;
            for (int i = 0; i < rows.Count; i++) rows[i] = new Rectangle(8, rows[i].Y, w - 16, 30);
            var wa = Screen.PrimaryScreen.WorkingArea; const int m = 16;
            int x = corner.EndsWith("l") ? wa.Left + m : wa.Right - w - m;
            int y = corner.StartsWith("t") ? wa.Top + m : wa.Bottom - h - m;
            SetBounds(x, y, w, h);
            using (var gp = Round(new Rectangle(0, 0, w, h), 12)) Region = new Region(gp);
            Invalidate();
        }

        static int Measure(string s, Font f) { return TextRenderer.MeasureText(s, f, new Size(1000, 100), TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Width; }

        public void Release() { HoldKeys(false, 0); }

        static GraphicsPath Round(Rectangle r, int rad)
        {
            var p = new GraphicsPath(); int d = rad * 2;
            p.AddArc(r.Left, r.Top, d, d, 180, 90); p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int idx = -1;
            for (int i = 0; i < rows.Count; i++) if (rows[i].Contains(e.Location)) idx = i;
            if (idx != hover) { hover = idx; Cursor = idx >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e) { if (hover != -1) { hover = -1; Invalidate(); } base.OnMouseLeave(e); }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            for (int i = 0; i < rows.Count; i++) if (rows[i].Contains(e.Location) && OnItem != null) { OnItem(i); break; }
            base.OnMouseClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using (var gp = Round(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            using (var pen = new Pen(Edge)) g.DrawPath(pen, gp);
            TextRenderer.DrawText(g, content.Title, fTitle, new Rectangle(18, 11, Width - 36, 18), Muted, Flags(content.Title) | TextFormatFlags.EndEllipsis);
            int y = 32;
            foreach (var l in content.Lines) { TextRenderer.DrawText(g, l.Text, fBody, new Rectangle(18, y, Width - 36, 22), l.Color, Flags(l.Text)); y += 24; }
            if (menu)
            {
                for (int i = 0; i < rows.Count; i++)
                {
                    var r = rows[i];
                    if (i == hover)
                        using (var gp = Round(r, 8)) using (var b = new SolidBrush(Hover)) g.FillPath(b, gp);
                    var it = content.Items[i];
                    TextRenderer.DrawText(g, it.Text, fBody, new Rectangle(r.X + 10, r.Y + 4, r.Width - 20, 22), it.Color, Flags(it.Text));
                }
                y = rows.Count > 0 ? rows[rows.Count - 1].Bottom + 2 : y;
            }
            if (status != "") { TextRenderer.DrawText(g, status, fBody, new Rectangle(18, y, Width - 36, 22), Color.FromArgb(61, 214, 245), Flags(status)); y += 26; }
            if (hint != "") TextRenderer.DrawText(g, hint, fSmall, new Rectangle(18, y + 2, Width - 36, 18), Muted, Flags(hint));
        }
    }

    public static class Overlay
    {
        static OverlayForm form;
        static System.Windows.Forms.Timer timer;
        static Func<OverlayContent> source;           // what to show; called a few times a second while visible
        static string status = ""; static DateTime statusUntil = DateTime.MinValue;
        static int mode;                              // 0 hidden, 1 status, 2 menu

        public static string Corner = "tr";
        public static bool StartInMenu;               // the shortcut opens the menu straight away (no status-only step)
        public static string StatusHint = "", MenuHint = "";
        public static Action Hidden;                  // called when the panel goes away (the owner stops what only the panel needed)

        public static bool Visible { get { return mode != 0; } }
        public static bool Menu { get { return mode == 2; } }

        public static void Init(Func<OverlayContent> content)
        {
            source = content;
            form = new OverlayForm();
            form.CreateControl(); var h = form.Handle;
            form.OnItem = i => Pick(i);
            form.OnEscape = () => SetMode(0);
            timer = new System.Windows.Forms.Timer { Interval = 500 };
            timer.Tick += (s, e) => Refresh();
        }

        static void Pick(int i)
        {
            if (source == null) return;
            var c = source();
            if (i < 0 || i >= c.Items.Count) return;
            var act = c.Items[i].Click;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { act(); } catch (Exception ex) { Program.Log("overlay command: " + ex.Message); }
                try { form.BeginInvoke(new Action(Refresh)); } catch { }
            });
        }

        /// <summary>a short message under the list ("done", "needs admin"...), shown for a few seconds</summary>
        public static void Flash(string text)
        {
            status = text; statusUntil = DateTime.Now.AddSeconds(4);
        }

        public static void Refresh()
        {
            if (form == null || mode == 0 || source == null) return;
            try
            {
                var c = source();
                bool asMenu = mode == 2 && c.Items.Count > 0;
                if (DateTime.Now > statusUntil) status = "";
                form.Set(c, Corner, asMenu, asMenu ? MenuHint : StatusHint, status);
            }
            catch (Exception ex) { Program.Log("overlay: " + ex.Message); }
        }

        public static void SetMode(int m)
        {
            if (form == null) return;
            mode = m;
            if (m == 0) { timer.Stop(); form.Release(); form.Hide(); var hid = Hidden; if (hid != null) hid(); return; }
            if (!form.Visible) form.Show();
            Refresh(); timer.Start();
        }

        public static void SetVisible(bool on) { SetMode(on ? (StartInMenu ? 2 : 1) : 0); }

        /// <summary>the overlay shortcut: hidden -> status -> menu -> hidden (or hidden -> menu -> hidden when it starts in the menu)</summary>
        public static void Cycle()
        {
            bool hasMenu = source != null && source().Items.Count > 0;
            if (mode == 0) SetMode(StartInMenu && hasMenu ? 2 : 1);
            else if (mode == 1 && hasMenu) SetMode(2);
            else SetMode(0);
        }

        public static void Toggle() { SetVisible(!Visible); }

        public static void Dispose() { try { if (timer != null) timer.Stop(); if (form != null) { form.Release(); form.Close(); } } catch { } }
    }
}
