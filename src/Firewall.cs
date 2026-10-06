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

        public static string RuleName(string ip) { return Prefix + ip; }

        public static bool ValidIp(string s)
        {
            IPAddress a;
            return s != null && Regex.IsMatch(s, @"^\d{1,3}(\.\d{1,3}){3}$") && IPAddress.TryParse(s, out a) && Analyzer.IsPublicIp(s);
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
            string action = a["fw"];
            string ip = a.ContainsKey("ip") ? a["ip"] : "";
            if (!ValidIp(ip)) return 2;
            string o;
            string name = RuleName(ip);
            // always start clean so repeated clicks never create duplicates
            Netsh("advfirewall firewall delete rule name=\"" + name + "\"", out o);
            if (action == "unblock") return 0;
            if (action != "block") return 2;
            return Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ip +
                         " description=\"Created by GameNetKit\"", out o);
        }
    }
}
