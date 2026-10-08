// Region lock: while a chosen game runs, its UDP traffic to cloud data centres outside the Middle East is refused, so the game
// cannot pick (or even measure) a server in Europe, Asia or America and falls back to the nearest region it is still allowed to reach.
//
// The address lists are the ones the cloud providers publish themselves, with the region of every range:
//   Amazon  https://ip-ranges.amazonaws.com/ip-ranges.json   (service EC2)
//   Google  https://www.gstatic.com/ipranges/cloud.json
// The rule is bound to the game's own program, only UDP, only outgoing: the game's sign-in, store and chat (TCP) and every other
// program keep working. Rules are named "GameNetKitRegion <game> #n", created while the game runs and removed when it stops.
// Runs inside the guard (elevated).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace GameNetKit
{
    public static class RegionLock
    {
        public const string RulePrefix = "GameNetKitRegion ";
        const int ChunkSize = 400;      // addresses in one firewall rule

        // regions that stay reachable: Bahrain and the UAE at Amazon, Doha and Dammam at Google
        static readonly HashSet<string> AwsKeep = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "me-south-1", "me-central-1" };
        static readonly HashSet<string> GcpKeep = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "me-central1", "me-central2" };

        static string Dir { get { return Path.Combine(Program.DataDir, "regions"); } }
        static readonly JavaScriptSerializer Js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public static string RuleName(string game) { return RulePrefix + game; }

        // ---------------------------------------------------------------- the lists (downloaded now and then, kept on disk)
        static string Load(string file, string url, out string why)
        {
            why = "";
            string path = Path.Combine(Dir, file);
            try
            {
                if (File.Exists(path) && (DateTime.Now - File.GetLastWriteTime(path)).TotalDays < 7 && new FileInfo(path).Length > 1000)
                    return File.ReadAllText(path);
            }
            catch { }
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768;
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 30000; req.ReadWriteTimeout = 60000; req.UserAgent = "GameNetKit/" + Program.Version;
                using (var res = req.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    string text = sr.ReadToEnd();
                    if (text.Length < 1000) throw new Exception("answer too short");
                    Directory.CreateDirectory(Dir);
                    File.WriteAllText(path, text, new UTF8Encoding(false));
                    return text;
                }
            }
            catch (Exception e)
            {
                why = file + ": " + e.Message;
                try { if (File.Exists(path)) return File.ReadAllText(path); } catch { }     // an old list is better than none
                return null;
            }
        }

        // ---------------------------------------------------------------- ranges
        sealed class V4 { public long A, B; }

        static bool ParseCidr4(string cidr, out long start, out long end)
        {
            start = end = 0;
            string[] p = cidr.Split('/');
            IPAddress ip;
            int len;
            if (p.Length != 2 || !IPAddress.TryParse(p[0], out ip) || !int.TryParse(p[1], out len) || len < 0 || len > 32) return false;
            byte[] b = ip.GetAddressBytes();
            if (b.Length != 4) return false;
            long v = ((long)b[0] << 24) | ((long)b[1] << 16) | ((long)b[2] << 8) | b[3];
            long size = 1L << (32 - len);
            start = v & ~(size - 1);
            end = start + size - 1;
            return true;
        }

        static string Ip4(long x) { return ((x >> 24) & 255) + "." + ((x >> 16) & 255) + "." + ((x >> 8) & 255) + "." + (x & 255); }

        // overlapping and neighbouring ranges become one, so the firewall gets a few thousand entries instead of tens of thousands
        static List<string> Merge(List<V4> list)
        {
            var res = new List<string>();
            if (list.Count == 0) return res;
            list.Sort((x, y) => x.A.CompareTo(y.A));
            long a = list[0].A, b = list[0].B;
            for (int i = 1; i < list.Count; i++)
            {
                if (list[i].A <= b + 1) { if (list[i].B > b) b = list[i].B; }
                else { res.Add(a == b ? Ip4(a) : Ip4(a) + "-" + Ip4(b)); a = list[i].A; b = list[i].B; }
            }
            res.Add(a == b ? Ip4(a) : Ip4(a) + "-" + Ip4(b));
            return res;
        }

        // every address range of Amazon EC2 and Google Cloud that lies outside the allowed regions (null: no list could be had)
        public static List<string> BlockedRanges(out string why)
        {
            why = "";
            var v4 = new List<V4>();
            var v6 = new HashSet<string>();
            int sources = 0;
            string w;

            string aws = Load("aws-ip-ranges.json", "https://ip-ranges.amazonaws.com/ip-ranges.json", out w);
            if (w != "") why = w;
            if (aws != null)
                try
                {
                    var root = (Dictionary<string, object>)Js.DeserializeObject(aws);
                    foreach (object o in (object[])root["prefixes"])
                    {
                        var d = (Dictionary<string, object>)o;
                        if (Convert.ToString(d["service"]) != "EC2" || AwsKeep.Contains(Convert.ToString(d["region"]))) continue;
                        long s, e;
                        if (ParseCidr4(Convert.ToString(d["ip_prefix"]), out s, out e)) v4.Add(new V4 { A = s, B = e });
                    }
                    if (root.ContainsKey("ipv6_prefixes"))
                        foreach (object o in (object[])root["ipv6_prefixes"])
                        {
                            var d = (Dictionary<string, object>)o;
                            if (Convert.ToString(d["service"]) != "EC2" || AwsKeep.Contains(Convert.ToString(d["region"]))) continue;
                            v6.Add(Convert.ToString(d["ipv6_prefix"]));
                        }
                    sources++;
                }
                catch (Exception e) { why = "aws list: " + e.Message; }

            string gcp = Load("gcp-cloud.json", "https://www.gstatic.com/ipranges/cloud.json", out w);
            if (w != "" && why == "") why = w;
            if (gcp != null)
                try
                {
                    var root = (Dictionary<string, object>)Js.DeserializeObject(gcp);
                    foreach (object o in (object[])root["prefixes"])
                    {
                        var d = (Dictionary<string, object>)o;
                        string scope = d.ContainsKey("scope") ? Convert.ToString(d["scope"]) : "";
                        if (scope == "" || scope == "global" || GcpKeep.Contains(scope)) continue;
                        if (d.ContainsKey("ipv4Prefix"))
                        {
                            long s, e;
                            if (ParseCidr4(Convert.ToString(d["ipv4Prefix"]), out s, out e)) v4.Add(new V4 { A = s, B = e });
                        }
                        else if (d.ContainsKey("ipv6Prefix")) v6.Add(Convert.ToString(d["ipv6Prefix"]));
                    }
                    sources++;
                }
                catch (Exception e) { if (why == "") why = "google list: " + e.Message; }

            if (sources == 0) return null;
            var all = Merge(v4);
            all.AddRange(v6);
            return all;
        }

        // ---------------------------------------------------------------- firewall rules (elevated)
        static string Q(string s) { return (s ?? "").Replace("'", "''"); }

        static int Ps(string script, out string output)
        {
            string file = Path.Combine(Dir, "apply.ps1");
            Directory.CreateDirectory(Dir);
            File.WriteAllText(file, script, new UTF8Encoding(true));
            return ProcUtil.Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + file + "\"", 180000, out output);
        }

        // 0 = rules are in place for this program
        public static int Apply(string game, string exe, List<string> ranges, out string output)
        {
            output = "";
            string tmp = Path.Combine(Dir, "chunks");
            Directory.CreateDirectory(tmp);
            foreach (string f in Directory.GetFiles(tmp, "chunk*.txt")) { try { File.Delete(f); } catch { } }
            int n = 0;
            for (int i = 0; i < ranges.Count; i += ChunkSize)
            {
                n++;
                File.WriteAllLines(Path.Combine(tmp, "chunk" + n.ToString("D3", CultureInfo.InvariantCulture) + ".txt"), ranges.Skip(i).Take(ChunkSize).ToArray(), new UTF8Encoding(false));
            }
            string name = RuleName(game);
            var sb = new StringBuilder();
            sb.AppendLine("$ErrorActionPreference = 'Stop'");
            sb.AppendLine("Get-NetFirewallRule -DisplayName '" + Q(name) + "*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule");
            sb.AppendLine("$i = 0");
            sb.AppendLine("foreach ($f in (Get-ChildItem '" + Q(tmp) + "' -Filter 'chunk*.txt' | Sort-Object Name)) {");
            sb.AppendLine("  $a = @(Get-Content -LiteralPath $f.FullName | Where-Object { $_ -ne '' }); $i++");
            sb.AppendLine("  New-NetFirewallRule -DisplayName ('" + Q(name) + " #' + $i) -Direction Outbound -Action Block -Protocol UDP -Program '" + Q(exe) +
                          "' -RemoteAddress $a -Description 'Created by GameNetKit (region lock)' | Out-Null");
            sb.AppendLine("}");
            int rc = Ps(sb.ToString(), out output);
            foreach (string f in Directory.GetFiles(tmp, "chunk*.txt")) { try { File.Delete(f); } catch { } }
            return rc;
        }

        // removes the rules of one game, or of every game when game is null
        public static int Remove(string game, out string output)
        {
            string pattern = game == null ? RulePrefix + "*" : RuleName(game) + "*";
            return ProcUtil.Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"Get-NetFirewallRule -DisplayName '" + Q(pattern) +
                                "' -ErrorAction SilentlyContinue | Remove-NetFirewallRule\"", 60000, out output);
        }

        // ---------------------------------------------------------------- which games are locked (settings.json: "regionLock": { "<game>": true })
        public static HashSet<string> LockedGames()
        {
            var set = new HashSet<string>();
            try
            {
                string path = Path.Combine(Program.DataDir, "settings.json");
                if (!File.Exists(path)) return set;
                var d = (Dictionary<string, object>)Js.DeserializeObject(File.ReadAllText(path));
                if (d.ContainsKey("regionLock") && d["regionLock"] is Dictionary<string, object>)
                    foreach (var kv in (Dictionary<string, object>)d["regionLock"])
                        if (kv.Value is bool && (bool)kv.Value) set.Add(kv.Key);
            }
            catch { }
            return set;
        }

        // `GameNetKit.exe --regiontest`: lists what would be blocked, without touching the firewall
        public static int SelfTest()
        {
            string why;
            var r = BlockedRanges(out why);
            string line = r == null ? "no list: " + why : r.Count + " ranges to block (first: " + r[0] + ", " + r.Count(x => x.Contains(":")) + " IPv6)" + (why != "" ? " [" + why + "]" : "");
            try { Directory.CreateDirectory(Dir); File.WriteAllText(Path.Combine(Dir, "selftest.txt"), line); } catch { }      // the program has no console window
            return r == null ? 1 : 0;
        }
    }
}
