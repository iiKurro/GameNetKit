// Blocking one game-server address (or a /16../32 range) so the game cannot reach it. Runs elevated (UAC) via
// "GameNetKit.exe --fw block|unblock|unblockall --ip x".
//
// Two independent methods, both removable and both only ever touching what this app created:
//   1. Windows Firewall rule named "GameNetKit block <ip>" (outbound, UDP)
//   2. a "dead end" network route (to the loopback pseudo-interface, metric 4242) - used automatically when
//      Windows refuses to add firewall rules on a machine (error 0x2 from a damaged firewall rule store).
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
        const string LoAlias = "Loopback Pseudo-Interface 1";
        const int RouteMetric = 4242;   // marks routes created by this app

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
                int from = Math.Max(0, lines.Length - 6);
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

        static string Flat(string s) { return (s ?? "").Trim().Replace("\r", "").Replace("\n", " "); }

        static string PrefixOf(string target) { return target.Contains("/") ? target : target + "/32"; }

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
            return ProcUtil.Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command + "\"", 40000, out output);
        }

        static int Netsh(string args, out string output)
        {
            return ProcUtil.Run("netsh.exe", args, 25000, out output);
        }

        // ------------------------------------------------------------------ routes
        static int AddRoute(string target, bool activeOnly, out string o)
        {
            // activeOnly: the route disappears at reboot, so a block that only lasts while a game runs cannot get stuck
            return Powershell("$i=(Get-NetIPInterface -InterfaceAlias '" + LoAlias + "' -AddressFamily IPv4 -ErrorAction Stop).ifIndex; " +
                              "New-NetRoute -DestinationPrefix '" + PrefixOf(target) + "' -InterfaceIndex $i -NextHop 0.0.0.0 -RouteMetric " + RouteMetric +
                              (activeOnly ? " -PolicyStore ActiveStore" : "") + " -ErrorAction Stop | Out-Null", out o);
        }

        static int RemoveRoute(string target, out string o)
        {
            return Powershell("Get-NetRoute -DestinationPrefix '" + PrefixOf(target) + "' -InterfaceAlias '" + LoAlias +
                              "' -ErrorAction SilentlyContinue | Where-Object { $_.RouteMetric -eq " + RouteMetric + " } | Remove-NetRoute -Confirm:$false -ErrorAction Stop", out o);
        }

        static bool RouteActive(string target)
        {
            string o;
            return Powershell("if (Get-NetRoute -DestinationPrefix '" + PrefixOf(target) + "' -InterfaceAlias '" + LoAlias +
                              "' -ErrorAction SilentlyContinue | Where-Object { $_.RouteMetric -eq " + RouteMetric + " }) { exit 0 } else { exit 1 }", out o) == 0;
        }

        // ------------------------------------------------------------------ queries (work without admin)
        // "firewall", "route", or "" when this target is not blocked by the app.
        public static string MethodOf(string ip)
        {
            if (!ValidIp(ip)) return "";
            string o;
            if (Netsh("advfirewall firewall show rule name=\"" + RuleName(ip) + "\"", out o) == 0) return "firewall";
            return RouteActive(ip) ? "route" : "";
        }

        public static bool IsActive(string ip) { return MethodOf(ip) != ""; }

        // Every target blocked by this app, with the method used (target -> "firewall" | "route").
        public static List<KeyValuePair<string, string>> ListTargets()
        {
            var res = new List<KeyValuePair<string, string>>();
            var seen = new HashSet<string>();
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
                    if (ValidIp(t) && seen.Add(t)) res.Add(new KeyValuePair<string, string>(t, "firewall"));
                }
                Powershell("Get-NetRoute -InterfaceAlias '" + LoAlias + "' -AddressFamily IPv4 -ErrorAction SilentlyContinue | " +
                           "Where-Object { $_.RouteMetric -eq " + RouteMetric + " } | ForEach-Object { $_.DestinationPrefix }", out o);
                foreach (string line in o.Split('\n'))
                {
                    string t = line.Trim();
                    if (t.EndsWith("/32")) t = t.Substring(0, t.Length - 3);
                    if (ValidIp(t) && seen.Add(t)) res.Add(new KeyValuePair<string, string>(t, "route"));
                }
            }
            catch { }
            return res;
        }

        // ------------------------------------------------------------------ elevated entry point
        // Exit code 0 = done.
        public static int Run(Dictionary<string, string> a)
        {
            try
            {
                string action = a["fw"];
                string ip = a.ContainsKey("ip") ? a["ip"] : "";
                Log("--- " + action + " " + ip);
                string o;

                if (action == "unblockall")
                {
                    int rca = Powershell("Get-NetFirewallRule -DisplayName '" + Prefix + "*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop", out o);
                    Log("remove all rules rc=" + rca + " " + Flat(o));
                    int rcb = Powershell("Get-NetRoute -InterfaceAlias '" + LoAlias + "' -AddressFamily IPv4 -ErrorAction SilentlyContinue | " +
                                         "Where-Object { $_.RouteMetric -eq " + RouteMetric + " } | Remove-NetRoute -Confirm:$false -ErrorAction Stop", out o);
                    Log("remove all routes rc=" + rcb + " " + Flat(o));
                    return rca != 0 ? rca : rcb;
                }

                if (!ValidIp(ip)) { Log("invalid target"); return 2; }
                if (action == "unblock") { Remove(ip); return RouteActive(ip) ? 4 : 0; }
                if (action != "block") return 2;
                return Apply(ip, false);
            }
            catch (Exception e) { Log("exception: " + e.Message); return 3; }
        }

        // Removes whatever this app created for one target (the rule and/or the route). Needs admin.
        public static void Remove(string ip)
        {
            string o;
            int rcDel = Netsh("advfirewall firewall delete rule name=\"" + RuleName(ip) + "\"", out o);
            Log("delete rule " + ip + " rc=" + rcDel + " " + Flat(o));
            int rcDelRoute = RemoveRoute(ip, out o);
            Log("delete route " + ip + " rc=" + rcDelRoute + " " + Flat(o));
        }

        // set once all firewall attempts failed in this process (the guard is long-lived): later blocks go straight to the route
        static bool firewallRefuses;

        // Blocks one target: a firewall rule first, a dead-end route when Windows refuses firewall rules. Needs admin. 0 = done.
        // temporary: a route (if one is needed) only lives until the next reboot - used for blocks that follow a running game.
        public static int Apply(string ip, bool temporary)
        {
            try
            {
                if (!ValidIp(ip)) { Log("invalid target"); return 2; }
                string o;
                string name = RuleName(ip);
                Remove(ip);   // always start clean so repeated clicks never create duplicates

                int rc = 1;
                if (!firewallRefuses)
                {
                    // 1) PowerShell's firewall cmdlet
                    rc = Powershell("New-NetFirewallRule -DisplayName '" + name + "' -Direction Outbound -Action Block -Protocol UDP -RemoteAddress " + ip +
                                    " -Description 'Created by GameNetKit' -ErrorAction Stop | Out-Null", out o);
                    Log("firewall (powershell) rc=" + rc + " " + Flat(o));
                    if (rc == 0) return 0;
                    // 2) netsh with an explicit start-end range
                    rc = Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ToRange(ip) +
                               " description=\"Created by GameNetKit\"", out o);
                    Log("firewall (netsh range) rc=" + rc + " " + Flat(o));
                    if (rc == 0) return 0;
                    // 3) netsh with the address exactly as given
                    rc = Netsh("advfirewall firewall add rule name=\"" + name + "\" dir=out action=block protocol=UDP remoteip=" + ip, out o);
                    Log("firewall (netsh) rc=" + rc + " " + Flat(o));
                    if (rc == 0) return 0;
                    firewallRefuses = true;
                    Log("firewall refuses rules: later blocks in this session use the route directly");
                }
                // 4) the firewall store refuses new rules on this PC: block with a dead-end route instead
                rc = AddRoute(ip, temporary, out o);
                Log("route rc=" + rc + " " + Flat(o));
                if (rc == 0) Log("blocked with a network route (firewall rules are not accepted on this PC)");
                return rc;
            }
            catch (Exception e) { Log("exception: " + e.Message); return 3; }
        }
    }
}
