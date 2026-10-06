// UiHost part 4: finding (and cleaning up) the app window by its private browser profile folder.
// The window is Edge started with --user-data-dir=<DataDir>\window, so every process belonging to it has that folder in its
// command line. This is more reliable than watching the process we launched, which may exit right away (hand-off).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;

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
    }
}
