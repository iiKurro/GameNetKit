// UiHost part 4: finding (and cleaning up) the app window by its private browser profile folder.
// The window is Edge started with --user-data-dir=<DataDir>\window, so every process belonging to it has that folder in its
// command line. This is more reliable than watching the process we launched, which may exit right away (hand-off).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

namespace GameNetKit
{
    public partial class UiHost
    {
        string WindowProfile { get { return Path.Combine(Program.DataDir, "window"); } }

        // ids of the browser processes that use our private profile folder
        List<int> WindowProcessIds()
        {
            var ids = new List<int>();
            string needle = WindowProfile.Replace("'", "''").Replace("\\", "\\\\").Replace("%", "[%]").Replace("_", "[_]");
            using (var s = new ManagementObjectSearcher("SELECT ProcessId, Name FROM Win32_Process WHERE CommandLine LIKE '%" + needle + "%'"))
            using (var results = s.Get())
                foreach (ManagementBaseObject o in results)
                {
                    string name = Convert.ToString(o["Name"]);
                    if (name.Equals("msedge.exe", StringComparison.OrdinalIgnoreCase) || name.Equals("chrome.exe", StringComparison.OrdinalIgnoreCase))
                        ids.Add(Convert.ToInt32(o["ProcessId"]));
                }
            return ids;
        }

        // true while the window exists. If WMI itself fails we assume it does: never close the server on a doubt.
        bool WindowAlive()
        {
            try { return WindowProcessIds().Count > 0; }
            catch (Exception e) { Program.Log("window check failed: " + e.Message); return true; }
        }

        // windows from a previous run are connected to a server that no longer exists; close them so only the new one is open
        void KillStaleWindows()
        {
            try
            {
                foreach (int id in WindowProcessIds())
                {
                    try { using (var p = Process.GetProcessById(id)) p.Kill(); } catch { }
                }
            }
            catch (Exception e) { Program.Log("closing old windows failed: " + e.Message); }
        }

        // ------------------------------------------------------------------ "already running": bring the window forward
        delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);

        // Finds the running app's window and shows it (restoring it if minimized). false = there is none to show.
        bool FocusExistingWindow()
        {
            try
            {
                var pids = new HashSet<uint>(WindowProcessIds().Select(i => (uint)i));
                if (pids.Count == 0) return false;
                IntPtr found = IntPtr.Zero;
                EnumWindows((h, l) =>
                {
                    uint pid;
                    GetWindowThreadProcessId(h, out pid);
                    if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
                    var title = new StringBuilder(256);
                    GetWindowText(h, title, 256);
                    if (title.ToString() == "GameNetKit") { found = h; return false; }
                    return true;
                }, IntPtr.Zero);
                if (found == IntPtr.Zero) return false;
                if (IsIconic(found)) ShowWindow(found, 9);   // SW_RESTORE
                keybd_event(0x12, 0, 0, UIntPtr.Zero);       // a tap on Alt lets this process take the foreground
                SetForegroundWindow(found);
                keybd_event(0x12, 0, 2, UIntPtr.Zero);
                return true;
            }
            catch (Exception e) { Program.Log("could not bring the window forward: " + e.Message); return false; }
        }
    }
}
