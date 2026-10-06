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

        // Targets ("1.2.3.4" or "1.2.3.0/24") of every firewall rule this app created. Readable without admin.
        public static List<string> ListTargets()
        {
            var res = new List<string>();
            try
            {
                string o;
                Powershell("(Get-NetFirewallRule -DisplayName '" + Prefix + "*' -ErrorAction SilentlyContinue).DisplayName", out o);
                foreach (string line in o.Split('\n'))
                {
                    string n = line.Trim();
                    if (!n.StartsWith(Prefix)) continue;
                    string t = n.Substring(Prefix.Length).Trim();
                    Match m = Regex.Match(t, @"^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,2})$");   // names use '-' instead of '/'
                    if (m.Success) t = m.Groups[1].Value + "/" + m.Groups[2].Value;
                    if (ValidIp(t) && !res.Contains(t)) res.Add(t);
                }
            }
            catch { }
            return res;
        }

        static string Flat(string s) { return (s ?? "").Trim().Replace("\r", "").Replace("\n", " "); }

        // "34.165.0.0/16" -> "34.165.0.0-34.165.255.255"; a plain address is returned unchanged
        static string ToRange(string target)
        {
            string[] p = target.Split('/');
            if (p.Length != 2) return target;
            byte[] b = IPAddress.Parse(p[0]).GetAddressBytes();
            uint ip = ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3];
            int len = int.Parse(p[1]);
            uint mask = len == 0 ? 0 : 0xFFFFFFFFu << (32 - len);
            uint start = ip & mask, end = start | ~mask;
            Func<uint, string> f = x => ((x >> 24) & 255) + "." + ((x >> 16) & 255) + "." + ((x >> 8) & 255) + "." + (x & 255);
            return f(start) + "-" + f(end);
        }

        static int Powershell(string command, out string output)
        {
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command + "\"")
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var p = Process.Start(psi))
            {
                string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                output = o;
                return p.ExitCode;
            }
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
                if (action == "unblockall")
                {
                    string oa;
                    int rca = Powershell("Get-NetFirewallRule -DisplayName '" + Prefix + "*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop", out oa);
                    Log("remove all rc=" + rca + " " + Flat(oa));
                    return rca;
                }
                if (!ValidIp(ip)) { Log("invalid target"); return 2; }
                string o;
                string name = RuleName(ip);
                // always start clean so repeated clicks never create duplicates
                int rcDel = Netsh("advfirewall firewall delete rule name=\"" + name + "\"", out o);
                Log("delete rc=" + rcDel + " " + Flat(o));
                if (action == "unblock") return 0;
                if (action != "block") return 2;
                // 1) PowerShell's firewall cmdlet (different code path than netsh, and it reports clearer errors)
                string ps = "New-NetFirewallRule -DisplayName '" + name + "' -Direction Outbound -Action Block -Protocol UDP -RemoteAddress " + ip +
                            " -Description 'Created by GameNetKit' -ErrorAction Stop | Out-Null";
                int rc = Powershell(ps, out o);
                Log("powershell add rc=" + rc + " " + Flat(o));
                if (rc == 0) return 0;
                // 2) netsh with an explicit start-end range
                rc = Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ToRange(ip) +
                           " description=\"Created by GameNetKit\"", out o);
                Log("netsh range add rc=" + rc + " " + Flat(o));
                if (rc == 0) return 0;
                // 3) netsh with the address exactly as given
                rc = Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ip, out o);
                Log("netsh add rc=" + rc + " " + Flat(o));
                return rc;
            }            catch (Exception e) { Log("exception: " + e.Message); return 3; }
        }    }
}
