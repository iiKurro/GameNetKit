// Windows Firewall block / unblock for one game-server IP. Runs elevated (UAC) via "GameNetKit.exe --fw block|unblock --ip x".
// It only ever touches rules named "GameNetKit block <ip>", only for a validated public IPv4 address.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Text.RegularExpressions;

namespace GameNetKit
{
    public static class Firewall
    {
        public const string Prefix = "GameNetKit block ";

        public static string RuleName(string ip) { return Prefix + ip.Replace("/", "-"); }

        public static string LogPath { get { return System.IO.Path.Combine(Program.DataDir, "fw-log.txt"); } }

        static void Log(string line)
        {
            try { System.IO.File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss") + " " + line + Environment.NewLine); } catch { }
        }

        // last lines of the log, shown in the UI when something fails
        public static string LastLog()
        {
            try
            {
                var lines = System.IO.File.ReadAllLines(LogPath);
                int from = Math.Max(0, lines.Length - 4);
                return string.Join("\n", lines, from, lines.Length - from);
            }
            catch { return ""; }
        }

        // A target is a public IPv4 address, or a public range a.b.c.d/16 .. /32 (never anything wider than /16).
        public static bool ValidIp(string s)
        {
            if (s == null || !Regex.IsMatch(s, @"^\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?$")) return false;
            string[] parts = s.Split('/');
            IPAddress a;
            if (!IPAddress.TryParse(parts[0], out a) || !Analyzer.IsPublicIp(parts[0])) return false;
            if (parts.Length == 2)
            {
                int len = int.Parse(parts[1]);
                if (len < 16 || len > 32) return false;
            }
            return true;
        }

        static int Netsh(string args, out string output)
        {
            var psi = new ProcessStartInfo("netsh.exe", args)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var p = Process.Start(psi))
            {
                output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        // Does our rule for this IP currently exist? (readable without admin)
        public static bool IsActive(string ip)
        {
            if (!ValidIp(ip)) return false;
            string o;
            return Netsh("advfirewall firewall show rule name=\"" + RuleName(ip) + "\"", out o) == 0;
        }

        // Elevated entry point. Exit code 0 = done.
        public static int Run(Dictionary<string, string> a)
        {
            try
            {
                string action = a["fw"];
                string ip = a.ContainsKey("ip") ? a["ip"] : "";
                Log("--- " + action + " " + ip);
                if (!ValidIp(ip)) { Log("invalid target"); return 2; }
                string o;
                string name = RuleName(ip);
                // always start clean so repeated clicks never create duplicates
                int rcDel = Netsh("advfirewall firewall delete rule name=\"" + name + "\"", out o);
                Log("delete rc=" + rcDel + " " + o.Trim().Replace("\r", "").Replace("\n", " "));
                if (action == "unblock") return 0;
                if (action != "block") return 2;
                int rc = Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ip +
                               " description=\"Created by GameNetKit\"", out o);
                Log("add rc=" + rc + " " + o.Trim().Replace("\r", "").Replace("\n", " "));
                return rc;
            }
            catch (Exception e) { Log("exception: " + e.Message); return 3; }
        }    }
}
