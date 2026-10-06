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

        public static bool IsPublicIp(string ip)
        {
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
                if (!m.Success) continue;
                parsedLines++;
                int sp = int.Parse(m.Groups[2].Value);
                int dp = int.Parse(m.Groups[4].Value);
                string remote; int rport;
                if (ports.Contains(sp)) { remote = m.Groups[3].Value; rport = dp; }
                else if (ports.Contains(dp)) { remote = m.Groups[1].Value; rport = sp; }
                else continue;
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
                var body = ips.Select(ip => new Dictionary<string, object> { { "query", ip }, { "fields", "status,country,city,isp,query" } }).ToList();
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
            for (int attempt = 0; attempt < 3; attempt++)
            {
                int size = 0;
                GetExtendedUdpTable(IntPtr.Zero, ref size, true, 2, 1, 0);
                IntPtr buf = Marshal.AllocHGlobal(size);
                try
                {
                    uint rc = GetExtendedUdpTable(buf, ref size, true, 2, 1, 0);
                    if (rc == 122) continue; // buffer too small, table grew
                    if (rc != 0) return;
                    int n = Marshal.ReadInt32(buf);
                    IntPtr p = IntPtr.Add(buf, 4);
                    for (int i = 0; i < n; i++)
                    {
                        uint raw = (uint)Marshal.ReadInt32(p, 4);
                        int port = (int)(((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF));
                        int pid = Marshal.ReadInt32(p, 8);
                        if (pids.Contains(pid)) into.Add(port);
                        p = IntPtr.Add(p, 12);
                    }
                    return;
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
        }
    }
}
