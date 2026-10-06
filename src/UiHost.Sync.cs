// UiHost part 6: automatic sharing with the group server (see /server).
//   - every finished scan is uploaded as soon as the loop notices it (the window also pokes the loop right after a scan)
//   - every ~10 s the app asks the server for scans newer than the last one it saw and files them under People\<name>_<id>
//     (my own scans that come back, e.g. after a reinstall, are restored into my History)
// The group code and this PC's player secret are stored encrypted for the current Windows user (DPAPI) in sync.json.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace GameNetKit
{
    public partial class UiHost
    {
        string SyncPath { get { return Path.Combine(Program.DataDir, "sync.json"); } }
        readonly object syncLock = new object();
        readonly ManualResetEvent syncWake = new ManualResetEvent(false);
        string syncError = "";
        DateTime syncLastOk = DateTime.MinValue;
        int syncPlayers;
        bool syncBusy;

        // ------------------------------------------------------------------ stored settings
        static string Protect(string s)
        {
            return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser));
        }

        static string Unprotect(string b64)
        {
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(b64), null, DataProtectionScope.CurrentUser)); }
            catch { return ""; }
        }

        class SyncCfg
        {
            public bool Enabled;
            public string Server = "";
            public string Code = "";
            public string Secret = "";
            public long Cursor;
            public HashSet<string> Pushed = new HashSet<string>();
        }

        SyncCfg LoadSync()
        {
            var c = new SyncCfg { Server = args.ContainsKey("syncserver") ? args["syncserver"] : Program.SyncServer };
            lock (syncLock)
            {
                try
                {
                    if (File.Exists(SyncPath))
                    {
                        var d = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(SyncPath));
                        if (d.ContainsKey("enabled") && d["enabled"] is bool) c.Enabled = (bool)d["enabled"];
                        if (d.ContainsKey("code")) c.Code = Unprotect(Convert.ToString(d["code"]));
                        if (d.ContainsKey("secret")) c.Secret = Unprotect(Convert.ToString(d["secret"]));
                        if (d.ContainsKey("cursor")) c.Cursor = Convert.ToInt64(d["cursor"]);
                        if (d.ContainsKey("pushed") && d["pushed"] is object[])
                            foreach (object o in (object[])d["pushed"]) c.Pushed.Add(Convert.ToString(o));
                    }
                }
                catch { }
            }
            return c;
        }

        void SaveSync(SyncCfg c)
        {
            lock (syncLock)
            {
                Directory.CreateDirectory(Program.DataDir);
                var d = new Dictionary<string, object>
                {
                    { "enabled", c.Enabled }, { "code", c.Code == "" ? "" : Protect(c.Code) }, { "secret", c.Secret == "" ? "" : Protect(c.Secret) },
                    { "cursor", c.Cursor }, { "pushed", c.Pushed.ToList() }
                };
                File.WriteAllText(SyncPath, js.Serialize(d), new UTF8Encoding(false));
            }
        }

        // ------------------------------------------------------------------ API for the window
        object SyncState()
        {
            var c = LoadSync();
            return new Dictionary<string, object>
            {
                { "configured", c.Server != "" },
                { "hasCode", c.Code != "" },
                { "enabled", c.Enabled && c.Code != "" },
                { "error", syncError },
                { "lastOkSecondsAgo", syncLastOk == DateTime.MinValue ? -1 : (int)(DateTime.Now - syncLastOk).TotalSeconds },
                { "players", syncPlayers },
                { "uploaded", c.Pushed.Count },
                { "busy", syncBusy }
            };
        }

        object SyncConfigure(Dictionary<string, object> body)
        {
            var c = LoadSync();
            if (body.ContainsKey("code"))
            {
                string code = Convert.ToString(body["code"]).Trim();
                if (code.Length > 80) return Fail("bad code");
                if (code != c.Code)
                {
                    // another group: start from scratch (everything is uploaded to it, and its history is fetched from the beginning)
                    c.Code = code; c.Cursor = 0; c.Pushed.Clear();
                    syncError = ""; syncLastOk = DateTime.MinValue;
                }
                if (code != "") c.Enabled = true;
            }
            if (body.ContainsKey("enabled") && body["enabled"] is bool) c.Enabled = (bool)body["enabled"];
            SaveSync(c);
            syncWake.Set();
            return SyncState();
        }

        object SyncNow() { syncWake.Set(); return Ok(); }

        // ------------------------------------------------------------------ the loop
        void StartSyncLoop()
        {
            var t = new Thread(() =>
            {
                Thread.Sleep(2000);
                while (true)
                {
                    try { SyncOnce(); }
                    catch (Exception e) { syncError = "net"; Program.Log("sync failed: " + e.Message); }
                    syncWake.WaitOne(10000);
                    syncWake.Reset();
                }
            }) { IsBackground = true };
            t.Start();
        }

        // one HTTP call; returns the parsed JSON object, or throws a SyncException with a short code
        class SyncException : Exception { public string Code; public SyncException(string code, string msg) : base(msg) { Code = code; } }

        Dictionary<string, object> Call(SyncCfg c, string method, string path, string playerId, object body)
        {
            var req = (HttpWebRequest)WebRequest.Create(c.Server.TrimEnd('/') + path);
            req.Method = method;
            req.Timeout = 20000;
            req.UserAgent = "GameNetKit/" + Program.Version;
            req.Headers["x-group"] = c.Code;
            req.Headers["x-player-secret"] = c.Secret;
            if (playerId != null) req.Headers["x-player"] = playerId;
            if (body != null)
            {
                byte[] data = Encoding.UTF8.GetBytes(js.Serialize(body));
                req.ContentType = "application/json";
                using (var rs = req.GetRequestStream()) rs.Write(data, 0, data.Length);
            }
            try
            {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return (Dictionary<string, object>)js.DeserializeObject(sr.ReadToEnd());
            }
            catch (WebException e)
            {
                var r = e.Response as HttpWebResponse;
                if (r == null) throw new SyncException("net", e.Message);
                int code = (int)r.StatusCode;
                throw new SyncException(code == 401 ? "code" : code == 403 ? "player" : "server", "HTTP " + code);
            }
        }

        void SyncOnce()
        {
            var c = LoadSync();
            var me = ReadProfile();
            if (!c.Enabled || c.Server == "" || c.Code == "" || me == null) return;
            // The player secret is derived from the group code and the player id, so it is always the same for this player in this
            // group (a random one would be lost with the settings file and lock the player out of their own id).
            using (var sha = SHA256.Create())
                c.Secret = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(c.Code + "|" + Convert.ToString(me["id"]) + "|gamenetkit-player"))).Replace("-", "").ToLowerInvariant();
            syncBusy = true;
            try
            {
                string myId = Convert.ToString(me["id"]), myName = Convert.ToString(me["name"]);
                try
                {
                    Push(c, myId, myName);
                    Pull(c, myId);
                    var st = Call(c, "GET", "/v1/status", null, null);
                    syncPlayers = Convert.ToInt32(st["players"]);
                    syncError = "";
                    syncLastOk = DateTime.Now;
                }
                catch (SyncException e) { syncError = e.Code; Program.Log("sync: " + e.Code + " " + e.Message); }
                SaveSync(c);
            }
            finally { syncBusy = false; }
        }

        // my scans that the server has not seen yet, at most 40 per request
        void Push(SyncCfg c, string myId, string myName)
        {
            if (!Directory.Exists(HistoryRoot)) return;
            var pending = new List<KeyValuePair<string, Dictionary<string, object>>>();
            foreach (string gdir in Directory.GetDirectories(HistoryRoot))
                foreach (string f in Directory.GetFiles(gdir, "*.json"))
                {
                    var run = LoadRun(f);
                    if (run == null || !run.ContainsKey("id") || !run.ContainsKey("game") || !run.ContainsKey("results")) continue;
                    string key = Convert.ToString(run["game"]) + "|" + Convert.ToString(run["id"]);
                    if (!c.Pushed.Contains(key)) pending.Add(new KeyValuePair<string, Dictionary<string, object>>(key, run));
                }
            for (int i = 0; i < pending.Count; i += 40)
            {
                var chunk = pending.Skip(i).Take(40).ToList();
                var body = new Dictionary<string, object>
                {
                    { "player", new Dictionary<string, object> { { "id", myId }, { "name", myName } } },
                    { "runs", chunk.Select(k => (object)new Dictionary<string, object>
                        { { "id", k.Value["id"] }, { "game", k.Value["game"] }, { "time", k.Value.ContainsKey("time") ? k.Value["time"] : "" }, { "results", k.Value["results"] } }).ToList() }
                };
                Call(c, "POST", "/v1/runs", null, body);
                foreach (var k in chunk) c.Pushed.Add(k.Key);
            }
        }

        // everything newer than the cursor: friends' scans go to People\..., my own are restored if missing
        void Pull(SyncCfg c, string myId)
        {
            for (int guard = 0; guard < 50; guard++)
            {
                var r = Call(c, "GET", "/v1/runs?since=" + c.Cursor + "&limit=300", null, null);
                foreach (object o in (object[])r["runs"])
                {
                    try { Accept(c, myId, (Dictionary<string, object>)o); } catch (Exception e) { Program.Log("sync: skipped a bad run: " + e.Message); }
                }
                c.Cursor = Convert.ToInt64(r["next"]);
                if (!(r["more"] is bool) || !(bool)r["more"]) break;
            }
        }

        void Accept(SyncCfg c, string myId, Dictionary<string, object> run)
        {
            var pl = (Dictionary<string, object>)run["player"];
            string pid = Convert.ToString(pl["id"]);
            string pname = CleanName(Convert.ToString(pl["name"]));
            string rid = Convert.ToString(run["id"]);
            string game = CleanName(Convert.ToString(run["game"]));
            object[] results = (object[])run["results"];
            if (!Regex.IsMatch(pid, "^[a-f0-9]{6,16}$") || pname == "" || !SafeId(rid) || game == "" || results.Length == 0 || results.Length > 40) return;

            var clean = new Dictionary<string, object>
            {
                { "id", rid }, { "time", Convert.ToString(run["time"]).Length > 20 ? "" : Convert.ToString(run["time"]) }, { "game", game }, { "results", results }
            };
            string gslug = Program.Slug(game);
            if (pid == myId)
            {
                string mine = Path.Combine(HistoryDirFor(gslug), rid + ".json");
                if (!File.Exists(mine)) { Directory.CreateDirectory(HistoryDirFor(gslug)); File.WriteAllText(mine, js.Serialize(clean), new UTF8Encoding(false)); }
                c.Pushed.Add(game + "|" + rid);
                return;
            }

            // one folder per person, found by id so a renamed friend does not get a second folder
            string dir = null;
            if (Directory.Exists(PeopleRoot))
                dir = Directory.GetDirectories(PeopleRoot).FirstOrDefault(d => Path.GetFileName(d).EndsWith("_" + pid, StringComparison.Ordinal));
            if (dir == null) dir = Path.Combine(PeopleRoot, Program.Slug(pname) + "_" + pid);
            Directory.CreateDirectory(dir);
            string pj = Path.Combine(dir, "person.json");
            var info = File.Exists(pj) ? LoadRun(pj) : null;
            if (info == null || Convert.ToString(info["name"]) != pname)
                File.WriteAllText(pj, js.Serialize(new Dictionary<string, object>
                {
                    { "name", pname }, { "id", pid },
                    { "importedAt", info != null && info.ContainsKey("importedAt") ? info["importedAt"] : DateTime.Now.ToString("yyyy-MM-dd HH:mm", System.Globalization.CultureInfo.InvariantCulture) }
                }), new UTF8Encoding(false));
            string gdir = Path.Combine(dir, gslug);
            Directory.CreateDirectory(gdir);
            string target = Path.Combine(gdir, rid + ".json");
            if (!File.Exists(target)) File.WriteAllText(target, js.Serialize(clean), new UTF8Encoding(false));
        }
    }
}
