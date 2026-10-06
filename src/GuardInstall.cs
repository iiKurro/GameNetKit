// "Start with Windows": a scheduled task that runs the guard silently at sign-in and on demand, with administrator rights.
//
//   GameNetKit.exe --install-guard 1 --user DOMAIN\name     (elevated, one UAC prompt)  copy + task + start
//   GameNetKit.exe --uninstall-guard 1                      (elevated)                  stop + remove task + remove copy
//
// Why a copy in Program Files: a task that runs a file with the highest privileges must not point at a file any program of
// yours can overwrite (Downloads, Desktop, ...). The copy sits in a folder only administrators can write to.
// The user never has to approve anything for the guard once this exists: the UI just asks the task to run.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace GameNetKit
{
    public static class GuardInstall
    {
        public const string TaskName = "GameNetKit Guard";

        public static string InstallDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "GameNetKit"); } }
        // the guard has its own file name, so Task Manager shows "GameNetKit-Guard.exe" next to "GameNetKit.exe" (the window part)
        public const string GuardFileName = "GameNetKit-Guard.exe";
        public static string InstalledExe { get { return Path.Combine(InstallDir, GuardFileName); } }

        static void Log(string line)
        {
            try { File.AppendAllText(Path.Combine(Program.DataDir, "install-log.txt"), DateTime.Now.ToString("HH:mm:ss") + " " + line + Environment.NewLine); } catch { }
        }

        // single quotes inside a PowerShell single-quoted string are doubled
        static string Q(string s) { return (s ?? "").Replace("'", "''"); }

        static int Ps(string command, out string o) { return ProcUtil.Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command + "\"", 60000, out o); }

        // readable without admin
        public static bool TaskExists()
        {
            string o;
            return ProcUtil.Run("schtasks.exe", "/Query /TN \"" + TaskName + "\"", 10000, out o) == 0;
        }

        // runs the task (silently, elevated) - no prompt
        public static bool RunTask()
        {
            string o;
            int rc = ProcUtil.Run("schtasks.exe", "/Run /TN \"" + TaskName + "\"", 15000, out o);
            Program.Log("schtasks /Run rc=" + rc + " " + (o ?? "").Trim().Replace("\r", " ").Replace("\n", " "));
            return rc == 0;
        }

        static void StopRunningGuard()
        {
            try { File.WriteAllText(Guard.StopPath, "1"); } catch { }
            for (int i = 0; i < 20; i++)
            {
                bool any = false;
                foreach (string name in new[] { "GameNetKit", "GameNetKit-Guard" })
                    foreach (Process p in Process.GetProcessesByName(name))
                    {
                        try { if (p.Id != Process.GetCurrentProcess().Id && (GuardCmdLine(p.Id).Contains("--guard"))) any = true; } catch { }
                        p.Dispose();
                    }
                if (!any) return;
                Thread.Sleep(500);
            }
        }

        static string GuardCmdLine(int pid)
        {
            using (var s = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + pid))
            using (var r = s.Get())
                foreach (System.Management.ManagementBaseObject o in r) return Convert.ToString(o["CommandLine"]) ?? "";
            return "";
        }

        // Elevated entry point. 0 = done.
        public static int Install(Dictionary<string, string> a)
        {
            try
            {
                string user = a.ContainsKey("user") ? a["user"] : "";
                if (user == "" || user.IndexOfAny(new[] { '"', '\r', '\n' }) >= 0) { Log("bad user"); return 2; }
                string src = Process.GetCurrentProcess().MainModule.FileName;
                Log("install for " + user + " from " + src);

                StopRunningGuard();
                Directory.CreateDirectory(InstallDir);
                if (!string.Equals(Path.GetFullPath(src), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase))
                    File.Copy(src, InstalledExe, true);
                // earlier versions installed the copy as GameNetKit.exe: remove it, the task now points at the guard-named file
                try { string old = Path.Combine(InstallDir, "GameNetKit.exe"); if (File.Exists(old)) File.Delete(old); } catch (Exception e) { Log("old copy not removed: " + e.Message); }

                string o;
                string script =
                    "$a = New-ScheduledTaskAction -Execute '" + Q(InstalledExe) + "' -Argument '--guard 1'; " +
                    "$p = New-ScheduledTaskPrincipal -UserId '" + Q(user) + "' -LogonType Interactive -RunLevel Highest; " +
                    "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero); " +
                    "$t = New-ScheduledTaskTrigger -AtLogOn -User '" + Q(user) + "'; " +
                    "Register-ScheduledTask -TaskName '" + TaskName + "' -Action $a -Principal $p -Settings $s -Trigger $t -Description 'GameNetKit guard: applies game blocks while a game runs' -Force -ErrorAction Stop | Out-Null";
                int rc = Ps(script, out o);
                Log("register rc=" + rc + " " + (o ?? "").Trim().Replace("\r", " ").Replace("\n", " "));
                if (rc != 0) return rc;
                try { File.Delete(Guard.StopPath); } catch { }
                Ps("Start-ScheduledTask -TaskName '" + TaskName + "'", out o);
                return 0;
            }
            catch (Exception e) { Log("install failed: " + e.Message); return 3; }
        }

        public static int Uninstall()
        {
            try
            {
                string o;
                StopRunningGuard();
                int rc = Ps("Unregister-ScheduledTask -TaskName '" + TaskName + "' -Confirm:$false -ErrorAction SilentlyContinue", out o);
                Log("unregister rc=" + rc + " " + (o ?? "").Trim());
                try { if (Directory.Exists(InstallDir)) Directory.Delete(InstallDir, true); } catch (Exception e) { Log("could not delete " + InstallDir + ": " + e.Message); }
                try { File.Delete(Guard.StopPath); } catch { }
                return 0;
            }
            catch (Exception e) { Log("uninstall failed: " + e.Message); return 3; }
        }
    }
}
