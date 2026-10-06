// Packet-capture parsing, ping measurement, geo lookup. Pure logic, no UI. (C# 5 / .NET Framework 4)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace GameNetKit
{
    public class Srv
    {
        public string Ip;
        public int Port;
        public long Packets;
        public long Bytes;
    }

    public static class Analyzer
    {
        static readonly Regex PacketRx = new Regex(
            @"(\d{1,3}(?:\.\d{1,3}){3})\.(\d{1,5}) > (\d{1,3}(?:\.\d{1,3}){3})\.(\d{1,5}):.*?length (\d+)",
            RegexOptions.Compiled);

        // same line format as above, IPv6 flavour: "2001:db8::1.50000 > 2a00:1450::200e.7777: UDP, length 58"
        static readonly Regex PacketRx6 = new Regex(
            @"((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4})\.(\d{1,5}) > ((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4})\.(\d{1,5}):.*?length (\d+)",
            RegexOptions.Compiled);

        public static bool IsPublicIp(string ip)
        {
            IPAddress addr;
            if (!IPAddress.TryParse(ip, out addr)) return false;
            if (addr.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
            {
                byte[] b = addr.GetAddressBytes();
                if (b.All(x => x == 0) || IPAddress.IsLoopback(addr) || addr.IsIPv6LinkLocal || addr.IsIPv6Multicast || addr.IsIPv6SiteLocal) return false;
                if ((b[0] & 0xFE) == 0xFC) return false;                                  // unique local fc00::/7
                bool mapped = b.Take(10).All(x => x == 0) && b[10] == 0xFF && b[11] == 0xFF;   // ::ffff:a.b.c.d
                return !mapped;
            }
            int[] o = ip.Split('.').Select(int.Parse).ToArray();
            if (o[0] == 10 || o[0] == 127 || o[0] == 0 || o[0] >= 224) return false;
            if (o[0] == 192 && o[1] == 168) return false;
            if (o[0] == 172 && o[1] >= 16 && o[1] <= 31) return false;
            if (o[0] == 169 && o[1] == 254) return false;
            if (o[0] == 100 && o[1] >= 64 && o[1] <= 127) return false;
            return true;
        }

        // Keeps only packets that use one of the game's local UDP ports; groups by remote public IP.
        public static List<Srv> ParseCapture(IEnumerable<string> lines, HashSet<int> ports, out long parsedLines)
        {
            var map = new Dictionary<string, Srv>();
            parsedLines = 0;
            foreach (string line in lines)
            {
                Match m = PacketRx.Match(line);
                if (!m.Success) m = PacketRx6.Match(line);
                if (!m.Success) continue;
                parsedLines++;
                int sp = int.Parse(m.Groups[2].Value);
                int dp = int.Parse(m.Groups[4].Value);
                string remote; int rport;
                if (ports.Contains(sp)) { remote = m.Groups[3].Value; rport = dp; }
                else if (ports.Contains(dp)) { remote = m.Groups[1].Value; rport = sp; }
                else continue;
                IPAddress parsedRemote;
                if (IPAddress.TryParse(remote, out parsedRemote)) remote = parsedRemote.ToString();   // one canonical spelling per address
                if (!IsPublicIp(remote)) continue;
                Srv s;
                if (!map.TryGetValue(remote, out s)) { s = new Srv { Ip = remote, Port = rport }; map[remote] = s; }
                s.Packets++;
                s.Bytes += long.Parse(m.Groups[5].Value);
            }
            return map.Values.OrderByDescending(x => x.Packets).ToList();
        }

        public class PingStat
        {
            public int? Avg; public int? Max; public double Jitter; public int Loss;
        }

        public static PingStat MeasurePing(string ip, int count)
        {
            var times = new List<int>();
            int lost = 0;
            using (var ping = new Ping())
            {
                for (int i = 0; i < count; i++)
                {
                    try
                    {
                        PingReply r = ping.Send(ip, 1000);
                        if (r != null && r.Status == IPStatus.Success) times.Add((int)r.RoundtripTime); else lost++;
                    }
                    catch { lost++; }
                    Thread.Sleep(200);
                }
            }
            var res = new PingStat();
            if (times.Count == 0) { res.Loss = 100; return res; }
            res.Avg = (int)Math.Round(times.Average());
            res.Max = times.Max();
            double jit = 0;
            if (times.Count > 1)
            {
                double sum = 0;
                for (int i = 1; i < times.Count; i++) sum += Math.Abs(times[i] - times[i - 1]);
                jit = sum / (times.Count - 1);
            }
            res.Jitter = Math.Round(jit, 1);
            res.Loss = (int)Math.Round(100.0 * lost / count);
            return res;
        }

        // ------------------------------------------------------------------ servers that do not answer ping
        // Many game servers (most Google Cloud and AWS ones) drop ICMP, so a plain ping says nothing. For those the latency is measured
        // to a public point that lives in the SAME cloud region (which the provider's published address lists tell us):
        //   AWS         TCP connect time to that region's DynamoDB endpoint
        //   Google      time of a keep-alive HTTPS request to that region's gcping.com endpoint (the standard Google Cloud latency test)
        // It is a real measurement, not a guess from distance, but it is to the region's front door, not to the game server itself,
        // so the result is marked (via = "gcp:europe-west1") and can differ from the true value by a few tens of milliseconds.
        public static string CacheDir = "";

        public class RegionInfo { public string Provider; public string Region; }

        class Prefix { public uint Net; public int Len; public string Region; }
        static List<Prefix> gcpPrefixes, awsPrefixes;
        static Dictionary<string, string> gcpEndpoints;
        static readonly object cloudLock = new object();

        // a cached copy of a public JSON file; refreshed when older than maxAgeDays, and a stale copy is still used when the download fails
        static string CloudFile(string name, string url, int maxAgeDays)
        {
            string path = "";
            try
            {
                string dir = Path.Combine(CacheDir == "" ? Path.GetTempPath() : CacheDir, "cloud");
                Directory.CreateDirectory(dir);
                path = Path.Combine(dir, name);
                if (!File.Exists(path) || (DateTime.Now - File.GetLastWriteTime(path)).TotalDays > maxAgeDays)
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Timeout = 20000; req.UserAgent = "GameNetKit/" + Program.Version;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        string text = sr.ReadToEnd();
                        if (text.Length > 1000) File.WriteAllText(path, text, new UTF8Encoding(false));
                    }
                }
            }
            catch { }
            try { return File.Exists(path) ? File.ReadAllText(path) : ""; } catch { return ""; }
        }

        static uint ToU(string ip) { byte[] b = IPAddress.Parse(ip).GetAddressBytes(); return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3]; }

        static List<Prefix> ParsePrefixes(string json, string listKey, string prefixKey, string regionKey)
        {
            var list = new List<Prefix>();
            if (json == "") return list;
            try
            {
                var js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 20 };
                var root = (Dictionary<string, object>)js.DeserializeObject(json);
                foreach (object o in (object[])root[listKey])
                {
                    var d = (Dictionary<string, object>)o;
                    if (!d.ContainsKey(prefixKey) || !d.ContainsKey(regionKey)) continue;
                    string[] p = Convert.ToString(d[prefixKey]).Split('/');
                    string region = Convert.ToString(d[regionKey]);
                    if (p.Length != 2 || region == "" || region == "GLOBAL" || region == "global") continue;
                    IPAddress a;
                    if (!IPAddress.TryParse(p[0], out a) || a.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                    list.Add(new Prefix { Net = ToU(p[0]), Len = int.Parse(p[1]), Region = region });
                }
            }
            catch { }
            return list;
        }

        static string Lookup(List<Prefix> list, uint ip)
        {
            string best = null; int bestLen = -1;
            foreach (var p in list)
            {
                uint mask = p.Len == 0 ? 0 : 0xFFFFFFFFu << (32 - p.Len);
                if ((ip & mask) == (p.Net & mask) && p.Len > bestLen) { best = p.Region; bestLen = p.Len; }
            }
            return best;
        }

        // which cloud region an IPv4 address belongs to (null = not a Google Cloud / AWS address, or the lists are unavailable)
        public static RegionInfo RegionOf(string ip)
        {
            IPAddress a;
            if (!IPAddress.TryParse(ip, out a) || a.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return null;
            uint u = ToU(ip);
            lock (cloudLock)
            {
                if (gcpPrefixes == null) gcpPrefixes = ParsePrefixes(CloudFile("gcp-ranges.json", "https://www.gstatic.com/ipranges/cloud.json", 7), "prefixes", "ipv4Prefix", "scope");
                string r = Lookup(gcpPrefixes, u);
                if (r != null) return new RegionInfo { Provider = "gcp", Region = r };
                if (awsPrefixes == null) awsPrefixes = ParsePrefixes(CloudFile("aws-ranges.json", "https://ip-ranges.amazonaws.com/ip-ranges.json", 7), "prefixes", "ip_prefix", "region");
                r = Lookup(awsPrefixes, u);
                if (r != null) return new RegionInfo { Provider = "aws", Region = r };
            }
            return null;
        }

        static string GcpUrl(string region)
        {
            lock (cloudLock)
            {
                if (gcpEndpoints == null)
                {
                    gcpEndpoints = new Dictionary<string, string>();
                    try
                    {
                        string json = CloudFile("gcping.json", "https://global.gcping.com/api/endpoints", 30);
                        var root = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
                        foreach (var kv in root)
                        {
                            var d = kv.Value as Dictionary<string, object>;
                            if (d != null && d.ContainsKey("URL")) gcpEndpoints[kv.Key] = Convert.ToString(d["URL"]);
                        }
                    }
                    catch { }
                }
                string u;
                return gcpEndpoints.TryGetValue(region, out u) && u.StartsWith("https://") ? u : null;
            }
        }

        static PingStat StatsOf(List<int> times, int tried)
        {
            if (times.Count == 0) return null;
            var res = new PingStat { Avg = (int)Math.Round(times.Average()), Max = times.Max() };
            double jit = 0;
            for (int i = 1; i < times.Count; i++) jit += Math.Abs(times[i] - times[i - 1]);
            res.Jitter = Math.Round(times.Count > 1 ? jit / (times.Count - 1) : 0, 1);
            res.Loss = (int)Math.Round(100.0 * (tried - times.Count) / tried);
            return res;
        }

        // null = could not be measured either
        public static PingStat MeasureRegion(RegionInfo r, int count)
        {
            if (r == null) return null;
            count = Math.Max(5, Math.Min(count, 12));
            var times = new List<int>();
            try
            {
                if (r.Provider == "aws")
                {
                    IPAddress ip = Dns.GetHostAddresses("dynamodb." + r.Region + ".amazonaws.com").FirstOrDefault(x => x.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
                    if (ip == null) return null;
                    for (int i = 0; i < count; i++)
                    {
                        using (var c = new System.Net.Sockets.TcpClient())
                        {
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var ar = c.BeginConnect(ip, 443, null, null);
                            if (ar.AsyncWaitHandle.WaitOne(1500) && c.Connected) { sw.Stop(); times.Add((int)Math.Max(1, sw.ElapsedMilliseconds)); }
                        }
                        Thread.Sleep(150);
                    }
                    return StatsOf(times, count);
                }
                if (r.Provider == "gcp")
                {
                    string url = GcpUrl(r.Region);
                    if (url == null) return null;
                    for (int i = 0; i <= count; i++)   // the first request opens the connection (DNS, TLS) and is not counted
                    {
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        try
                        {
                            var req = (HttpWebRequest)WebRequest.Create(url);
                            req.KeepAlive = true; req.Timeout = 4000; req.AllowAutoRedirect = false; req.UserAgent = "GameNetKit/" + Program.Version;
                            using (var resp = (HttpWebResponse)req.GetResponse())
                            using (var s = resp.GetResponseStream()) { var buf = new byte[512]; while (s.Read(buf, 0, buf.Length) > 0) { } }
                            sw.Stop();
                            if (i > 0) times.Add((int)Math.Max(1, sw.ElapsedMilliseconds));
                        }
                        catch { }
                        Thread.Sleep(150);
                    }
                    return StatsOf(times, count);
                }
            }
            catch { }
            return null;
        }
        public static string Verdict(PingStat s)
        {
            if (s.Avg == null) return "noreply";
            if (s.Loss >= 3) return "bad";
            if (s.Avg >= 100 || s.Jitter >= 15) return "bad";
            if (s.Avg >= 60) return "ok";
            return "good";
        }

        // Sends only the server IPs to ip-api.com (free, no key) to learn country / city / provider.
        public static Dictionary<string, Dictionary<string, object>> Geo(IEnumerable<string> ips)
        {
            var map = new Dictionary<string, Dictionary<string, object>>();
            try
            {
                var js = new JavaScriptSerializer();
                var body = ips.Select(ip => new Dictionary<string, object> { { "query", ip }, { "fields", "status,country,countryCode,city,isp,query" } }).ToList();
                var req = (HttpWebRequest)WebRequest.Create("http://ip-api.com/batch");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 15000;
                byte[] data = Encoding.UTF8.GetBytes(js.Serialize(body));
                using (var rs = req.GetRequestStream()) rs.Write(data, 0, data.Length);
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    object[] arr = (object[])js.DeserializeObject(sr.ReadToEnd());
                    foreach (object o in arr)
                    {
                        var d = (Dictionary<string, object>)o;
                        if ((string)d["status"] == "success") map[(string)d["query"]] = d;
                    }
                }
            }
            catch { }
            return map;
        }

        public static string Ptr(string ip)
        {
            try
            {
                var t = Task.Factory.StartNew(() => Dns.GetHostEntry(ip).HostName);
                if (t.Wait(2500)) return t.Result;
            }
            catch { }
            return "";
        }

        // ---- UDP ports owned by given process ids (Windows lists local UDP ports only, never the remote end) ----
        [DllImport("iphlpapi.dll", SetLastError = true)]
        static extern uint GetExtendedUdpTable(IntPtr table, ref int size, bool order, int af, int tableClass, uint reserved);

        public static void CollectUdpPorts(HashSet<int> pids, HashSet<int> into)
        {
            CollectUdpPorts(pids, into, 2);    // IPv4
            CollectUdpPorts(pids, into, 23);   // IPv6
        }

        // af 2 = AF_INET (12-byte rows), af 23 = AF_INET6 (28-byte rows: addr[16], scope, port, pid)
        static void CollectUdpPorts(HashSet<int> pids, HashSet<int> into, int af)
        {
            int rowSize = af == 2 ? 12 : 28, portOff = af == 2 ? 4 : 20, pidOff = af == 2 ? 8 : 24;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                int size = 0;
                GetExtendedUdpTable(IntPtr.Zero, ref size, true, af, 1, 0);
                IntPtr buf = Marshal.AllocHGlobal(size);
                try
                {
                    uint rc = GetExtendedUdpTable(buf, ref size, true, af, 1, 0);
                    if (rc == 122) continue; // buffer too small, table grew
                    if (rc != 0) return;
                    int n = Marshal.ReadInt32(buf);
                    IntPtr p = IntPtr.Add(buf, 4);
                    for (int i = 0; i < n; i++)
                    {
                        uint raw = (uint)Marshal.ReadInt32(p, portOff);
                        int port = (int)(((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF));
                        int pid = Marshal.ReadInt32(p, pidOff);
                        if (pids.Contains(pid)) into.Add(port);
                        p = IntPtr.Add(p, rowSize);
                    }
                    return;
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
        }
    }
}
