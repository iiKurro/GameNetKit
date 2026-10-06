// Notification-area icon: a way back to the window, and the Windows notification (with sound) when a scan has something to say.
// It lives in the window process only (not in the guard), on its own thread, and only while a window is open.
using System;
using System.Drawing;
using System.Media;
using System.Threading;
using System.Windows.Forms;

namespace GameNetKit
{
    public static class Tray
    {
        static NotifyIcon icon;
        static Control invoker;                    // lets other threads talk to the icon on its own thread
        static ToolStripMenuItem miOpen, miGuard, miExit;
        static Action onOpen, onExit;
        static Func<bool> guardOn;
        static string guardOnText = "Guard: running", guardOffText = "Guard: stopped";

        public static void Start(string exePath, Action open, Action exit, Func<bool> isGuardOn)
        {
            onOpen = open; onExit = exit; guardOn = isGuardOn;
            var t = new Thread(() =>
            {
                try
                {
                    Application.EnableVisualStyles();
                    Icon ico;
                    try { ico = Icon.ExtractAssociatedIcon(exePath) ?? SystemIcons.Application; } catch { ico = SystemIcons.Application; }
                    var menu = new ContextMenuStrip();
                    miOpen = new ToolStripMenuItem("GameNetKit", null, (s, e) => Safe(onOpen));
                    miOpen.Font = new Font(miOpen.Font, FontStyle.Bold);
                    miGuard = new ToolStripMenuItem("") { Enabled = false };
                    miExit = new ToolStripMenuItem("Exit", null, (s, e) => Safe(onExit));
                    menu.Items.Add(miOpen); menu.Items.Add(miGuard); menu.Items.Add(new ToolStripSeparator()); menu.Items.Add(miExit);
                    menu.Opening += (s, e) => { try { miGuard.Text = guardOn != null && guardOn() ? guardOnText : guardOffText; } catch { } };
                    icon = new NotifyIcon { Icon = ico, Text = "GameNetKit", ContextMenuStrip = menu, Visible = true };
                    icon.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) Safe(onOpen); };
                    icon.BalloonTipClicked += (s, e) => Safe(onOpen);
                    invoker = new Control(); invoker.CreateControl(); var h = invoker.Handle;
                    Application.Run();
                }
                catch (Exception e) { Program.Log("tray: " + e.Message); }
            }) { IsBackground = true, Name = "tray" };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }

        static void Safe(Action a) { try { if (a != null) ThreadPool.QueueUserWorkItem(delegate { try { a(); } catch (Exception e) { Program.Log("tray action: " + e.Message); } }); } catch { } }

        // menu texts follow the language of the window
        public static void SetLabels(string open, string guardRunning, string guardStopped, string exit)
        {
            guardOnText = guardRunning; guardOffText = guardStopped;
            Run(() => { if (miOpen != null) { miOpen.Text = open; miExit.Text = exit; } });
        }

        static void Run(Action a)
        {
            try { if (invoker != null && invoker.IsHandleCreated) invoker.BeginInvoke(a); } catch { }
        }

        public static void Notify(string title, string text, bool sound)
        {
            Run(() =>
            {
                if (icon == null) return;
                icon.BalloonTipTitle = title; icon.BalloonTipText = text; icon.BalloonTipIcon = ToolTipIcon.None;
                icon.ShowBalloonTip(7000);
            });
            if (sound) { try { SystemSounds.Asterisk.Play(); } catch { } }
        }

        public static void Stop()
        {
            try { Run(() => { if (icon != null) { icon.Visible = false; icon.Dispose(); icon = null; } Application.ExitThread(); }); Thread.Sleep(150); } catch { }
        }
    }
}
