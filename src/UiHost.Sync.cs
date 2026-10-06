// UiHost part 6: automatic sharing with the group server (see /server).
//   - every finished scan is uploaded as soon as the loop notices it (the window also pokes the loop right after a scan)
//   - every ~10 s the app asks the server for scans newer than the last one it saw and files them under People\<name>_<id>
//     (my own scans that come back, e.g. after a reinstall, are restored into my History)
// The group code and this PC's random player secret are stored encrypted for the current Windows user (DPAPI) in sync.json.
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
        int syncDenied;   // consecutive "this player id belongs to someone else" answers

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

        static string RandomHex(int bytes)
        {
            var b = new byte[bytes];
            using (var r = RandomNumberGenerator.Create()) r.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        class SyncCfg
        {
            public bool Enabled;
            public string Server = "";
            public string Code = "";
            public string Secret = "";
            public string Legacy = "";   // the secret version 1.0.0 derived from the code; sent only to upgrade an older registration
            public string PlayerId = "";   // sent as x-player when set
            public string Admin = "";      // the group admin code (only on the admin's PC)
            public bool HasPassword;       // Secret was derived from the player's password (an account that can be logged into from any PC)
            public string NewSecret = "";  // sent as x-new-secret when changing the account secret
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
                        if (d.ContainsKey("admin")) c.Admin = Unprotect(Convert.ToString(d["admin"]));
                        if (d.ContainsKey("pw") && d["pw"] is bool) c.HasPassword = (bool)d["pw"];
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
                    { "admin", c.Admin == "" ? "" : Protect(c.Admin) }, { "pw", c.HasPassword },
                    { "cursor", c.Cursor }, { "pushed", c.Pushed.ToList() }
                };
                string tmp = SyncPath + ".tmp";
                File.WriteAllText(tmp, js.Serialize(d), new UTF8Encoding(false));
                if (File.Exists(SyncPath)) File.Replace(tmp, SyncPath, null); else File.Move(tmp, SyncPath);
            }
        }

        // The loop works on a snapshot for up to a minute. When it is done only what it learned (cursor, uploaded ids, secret) is merged
        // into the file as it is NOW, so a code or switch the user changed meanwhile is never overwritten; a different code drops the result.
        void MergeSync(SyncCfg c)
        {
            lock (syncLock)
            {
                var cur = LoadSync();
                if (cur.Code != c.Code) return;
                cur.Cursor = c.Cursor; cur.Pushed = c.Pushed;
                if (!cur.HasPassword) cur.Secret = c.Secret;   // an account password chosen meanwhile is never replaced by the loop's older secret
                SaveSync(cur);
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
                { "admin", c.Admin != "" },
                { "hasPassword", c.HasPassword },
                { "busy", syncBusy }
            };
        }

        object SyncConfigure(Dictionary<string, object> body)
        {
            lock (syncLock)
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
                        syncError = ""; syncLastOk = DateTime.MinValue; syncDenied = 0;
                    }
                    if (code != "") c.Enabled = true;
                }
                if (body.ContainsKey("enabled") && body["enabled"] is bool) c.Enabled = (bool)body["enabled"];
                SaveSync(c);
            }
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

        Dictionary<string, object> Call(SyncCfg c, string method, string path, object body)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(c.Server.TrimEnd('/') + path);
                req.Method = method;
                req.Timeout = 20000;
                req.UserAgent = "GameNetKit/" + Program.Version;
                req.Headers["x-group"] = c.Code;
                req.Headers["x-player-secret"] = c.Secret;
                if (c.Legacy != "" && method != "GET") req.Headers["x-player-upgrade"] = c.Legacy;
                if (c.PlayerId != "") req.Headers["x-player"] = c.PlayerId;
                if (c.NewSecret != "") req.Headers["x-new-secret"] = c.NewSecret;
                if (c.Admin != "" && path.StartsWith("/v1/admin/")) req.Headers["x-admin"] = c.Admin;
                if (body != null)
                {
                    byte[] data = Encoding.UTF8.GetBytes(js.Serialize(body));
                    req.ContentType = "application/json";
                    using (var rs = req.GetRequestStream()) rs.Write(data, 0, data.Length);
                }
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return (Dictionary<string, object>)js.DeserializeObject(sr.ReadToEnd());
            }
            catch (WebException e)
            {
                var r = e.Response as HttpWebResponse;
                if (r == null) throw new SyncException("net", e.Message);
                int code = (int)r.StatusCode;
                r.Close();   // an unclosed error response keeps one of the two connections to the host busy
                throw new SyncException(code == 401 ? "code" : code == 403 ? "player" : code == 404 ? "unknown" : code == 409 ? "taken" : code == 413 ? "toobig" : code == 429 ? "full" : "server", "HTTP " + code);
            }
        }

        // a sync cycle and "delete my scans from the server" never run at the same time
        readonly object syncRun = new object();

        void SyncOnce()
        {
            lock (syncRun) SyncCycle();
        }

        // ------------------------------------------------------------------ accounts (name + password)
        // The password never leaves this PC: it is stretched (PBKDF2, 100k rounds, salted with the name) into a secret, and only that
        // secret is used to prove who you are to the server. With the same name and password on another PC (or after a reinstall) the
        // server hands back the same player id, and your own scans are restored from it.
        static string NameKey(string n) { return Regex.Replace((n ?? "").Trim().ToLowerInvariant(), @"\s+", " "); }

        static string DeriveSecret(string password, string name)
        {
            var salt = Encoding.UTF8.GetBytes("gamenetkit-v1|" + NameKey(name));
            using (var kdf = new Rfc2898DeriveBytes(password, salt, 100000))
                return BitConverter.ToString(kdf.GetBytes(32)).Replace("-", "").ToLowerInvariant();
        }

        // returns the id the server has for this name ("" = nobody has it yet); throws SyncException (player = wrong password)
        string ServerLogin(SyncCfg c, string name)
        {
            var r = Call(c, "POST", "/v1/login", new Dictionary<string, object> { { "name", name } });
            return r.ContainsKey("exists") && r["exists"] is bool && (bool)r["exists"] ? Convert.ToString(r["id"]) : "";
        }

        static string LoginError(SyncException e) { return e.Code == "player" ? "password" : e.Code == "full" ? "tries" : e.Code; }

        void WriteProfile(string name, string id)
        {
            Directory.CreateDirectory(Program.DataDir);
            File.WriteAllText(ProfilePath, js.Serialize(new Dictionary<string, object> { { "name", name }, { "id", id } }), new UTF8Encoding(false));
        }

        // First run: name (+ group code and password). Nothing is saved unless everything is accepted.
        object AccountStart(Dictionary<string, object> body)
        {
            if (ReadProfile() != null) return Fail("locked");
            string name = CleanName(body.ContainsKey("name") ? Convert.ToString(body["name"]) : "");
            string code = body.ContainsKey("code") ? Convert.ToString(body["code"]).Trim() : "";
            string pw = body.ContainsKey("password") ? Convert.ToString(body["password"]) : "";
            if (name == "") return Fail("name");
            var cfg = LoadSync();
            if (code == "" || cfg.Server == "")
            {
                // no sharing: a local profile only
                WriteProfile(name, NewId());
                return Ok();
            }
            if (code.Length > 80) return Fail("bad code");
            if (pw.Length < 6 || pw.Length > 100) return Fail("short");
            cfg.Code = code; cfg.Secret = DeriveSecret(pw, name); cfg.Legacy = "";
            string id;
            try { id = ServerLogin(cfg, name); }
            catch (SyncException e) { return Fail(LoginError(e)); }
            bool restored = id != "";
            if (!restored) id = NewId();
            WriteProfile(name, id);
            lock (syncLock)
            {
                var cur = LoadSync();
                cur.Code = code; cur.Secret = cfg.Secret; cur.HasPassword = true; cur.Enabled = true; cur.Cursor = 0; cur.Pushed = new HashSet<string>();
                SaveSync(cur);
                syncError = ""; syncLastOk = DateTime.MinValue; syncDenied = 0;
            }
            syncWake.Set();
            return new Dictionary<string, object> { { "ok", true }, { "restored", restored } };
        }

        // An existing player (from before passwords) chooses a password; or a player whose account was reset / has a new password
        // logs in again. Same checks as above, and the old secret is accepted once to carry the account over.
        object AccountPassword(Dictionary<string, object> body)
        {
            var me = ReadProfile();
            string pw = body.ContainsKey("password") ? Convert.ToString(body["password"]) : "";
            var cfg = LoadSync();
            if (me == null || cfg.Server == "" || cfg.Code == "") return Fail("nocode");
            if (pw.Length < 6 || pw.Length > 100) return Fail("short");
            string name = Convert.ToString(me["name"]), myId = Convert.ToString(me["id"]);
            string old = cfg.Secret, s = DeriveSecret(pw, name);
            cfg.Secret = s;
            string id;
            try { id = ServerLogin(cfg, name); }
            catch (SyncException e)
            {
                if (e.Code != "player" || cfg.HasPassword || old == "") return Fail(LoginError(e));
                id = null;   // the name exists under the OLD secret of this PC: carry the account over below
            }
            if (id == null || id == "")
            {
                if (!cfg.HasPassword && old != "")
                {
                    var c2 = LoadSync(); c2.Secret = old; c2.NewSecret = s; c2.PlayerId = myId;
                    using (var sha = SHA256.Create())
                        c2.Legacy = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(c2.Code + "|" + myId + "|gamenetkit-player"))).Replace("-", "").ToLowerInvariant();
                    try { Call(c2, "POST", "/v1/password", null); }
                    catch (SyncException e)
                    {
                        if (e.Code == "unknown") { /* never uploaded: nothing to carry over */ }
                        else return Fail(e.Code == "player" ? "password" : e.Code);
                    }
                }
            }
            else if (id != myId) { WriteProfile(name, id); myId = id; }
            lock (syncLock)
            {
                var cur = LoadSync();
                cur.Secret = s; cur.HasPassword = true;
                if (id != null && id != "" && id != Convert.ToString(me["id"])) { cur.Cursor = 0; cur.Pushed = new HashSet<string>(); }
                SaveSync(cur);
                syncError = ""; syncDenied = 0;
            }
            syncWake.Set();
            return Ok();
        }

        // ------------------------------------------------------------------ group admin
        // Only the person who owns the server's ADMIN_CODE can look at all players and remove scans. The code is typed into a hidden
        // dialog (Ctrl+Shift+A) and kept encrypted next to the group code; nobody else sees any admin control, and the server
        // refuses every admin call without the code anyway.
        object AdminUnlock(Dictionary<string, object> body)
        {
            var c = LoadSync();
            string code = body.ContainsKey("code") ? Convert.ToString(body["code"]).Trim() : "";
            if (c.Server == "" || c.Code == "") return Fail("nocode");
            if (code == "" || code.Length > 120) return Fail("admin");
            c.Admin = code;
            try { Call(c, "GET", "/v1/admin/players", null); }
            catch (SyncException e) { return Fail(e.Code == "player" ? "admin" : e.Code); }
            lock (syncLock) { var cur = LoadSync(); cur.Admin = code; SaveSync(cur); }
            return Ok();
        }

        object AdminReset(Dictionary<string, object> body)
        {
            var c = LoadSync();
            if (c.Admin == "") return Fail("admin");
            string player = body.ContainsKey("player") ? Convert.ToString(body["player"]) : "";
            if (!Regex.IsMatch(player, "^[a-f0-9]{6,16}$")) return Fail("bad player");
            try { return Call(c, "POST", "/v1/admin/reset", new Dictionary<string, object> { { "player", player } }); }
            catch (SyncException e) { return Fail(e.Code == "player" ? "admin" : e.Code); }
        }

        object AdminLock()
        {
            lock (syncLock) { var cur = LoadSync(); cur.Admin = ""; SaveSync(cur); }
            return Ok();
        }

        object AdminPlayers()
        {
            var c = LoadSync();
            if (c.Admin == "") return Fail("admin");
            try { return Call(c, "GET", "/v1/admin/players", null); }
            catch (SyncException e) { return Fail(e.Code == "player" ? "admin" : e.Code); }
        }

        object AdminRuns(Dictionary<string, object> body)
        {
            var c = LoadSync();
            if (c.Admin == "") return Fail("admin");
            string player = body.ContainsKey("player") ? Convert.ToString(body["player"]) : "";
            if (!Regex.IsMatch(player, "^[a-f0-9]{6,16}$")) return Fail("bad player");
            try { return Call(c, "GET", "/v1/admin/runs?player=" + player, null); }
            catch (SyncException e) { return Fail(e.Code == "player" ? "admin" : e.Code); }
        }

        object AdminDelete(Dictionary<string, object> body)
        {
            var c = LoadSync();
            if (c.Admin == "") return Fail("admin");
            string player = body.ContainsKey("player") ? Convert.ToString(body["player"]) : "";
            string game = body.ContainsKey("game") ? Convert.ToString(body["game"]) : "";
            if (!Regex.IsMatch(player, "^[a-f0-9]{6,16}$")) return Fail("bad player");
            string run = body.ContainsKey("run") ? Convert.ToString(body["run"]) : "";
            if (run != "" && !SafeId(run)) return Fail("bad run");
            var b = new Dictionary<string, object> { { "player", player } };
            if (game != "") b["game"] = game;
            if (run != "") b["run"] = run;
            try { return Call(c, "POST", "/v1/admin/delete", b); }
            catch (SyncException e) { return Fail(e.Code == "player" ? "admin" : e.Code); }
        }
        void SyncCycle()
        {
            var c = LoadSync();
            var me = ReadProfile();
            if (!c.Enabled || c.Server == "" || c.Code == "" || me == null) return;
            string myId = Convert.ToString(me["id"]), myName = Convert.ToString(me["name"]);
            // The player secret is random and private to this PC: nobody else in the group can post or delete as this player.
            // Version 1.0.0 derived it from the group code, so its registration is upgraded once with the old value (Legacy).
            if (c.Secret == "") c.Secret = RandomHex(32);
            using (var sha = SHA256.Create())
                c.Legacy = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(c.Code + "|" + myId + "|gamenetkit-player"))).Replace("-", "").ToLowerInvariant();
            syncBusy = true;
            try
            {
                try
                {
                    Push(c, myId, myName);
                    Pull(c, myId);
                    var st = Call(c, "GET", "/v1/status", null);
                    syncPlayers = Convert.ToInt32(st["players"]);
                    syncError = "";
                    syncDenied = 0;
                    syncLastOk = DateTime.Now;
                }
                catch (SyncException e)
                {
                    syncError = e.Code; Program.Log("sync: " + e.Code + " " + e.Message);
                    // an account with a password is never given a new identity: the owner logs in again (or the admin resets it)
                    if (e.Code == "player" && !c.HasPassword) { if (++syncDenied >= 3) RotateIdentity(c); } else syncDenied = 0;
                }
                MergeSync(c);
            }
            finally { syncBusy = false; }
        }

        // The server knows this id with a secret this PC no longer has (the settings file was deleted but the profile was kept):
        // continue as a new player. My scans stay in my History and are uploaded again under the new id.
        void RotateIdentity(SyncCfg c)
        {
            try
            {
                var me = ReadProfile();
                if (me == null) return;
                File.WriteAllText(ProfilePath, js.Serialize(new Dictionary<string, object> { { "name", me["name"] }, { "id", NewId() } }), new UTF8Encoding(false));
                c.Secret = RandomHex(32); c.Pushed = new HashSet<string>();
                syncDenied = 0; syncError = "";
                Program.Log("sync: player id was taken by an older registration; continuing with a new id");
            }
            catch (Exception e) { Program.Log("sync: could not change player id: " + e.Message); }
        }

        // my scans that the server has not seen yet, in requests of at most 40 scans / about 150 KB
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
            int i = 0;
            while (i < pending.Count)
            {
                var chunk = new List<KeyValuePair<string, Dictionary<string, object>>>();
                int size = 0;
                while (i < pending.Count && chunk.Count < 40)
                {
                    int n = js.Serialize(pending[i].Value["results"]).Length + 200;
                    if (chunk.Count > 0 && size + n > 150000) break;
                    chunk.Add(pending[i]); size += n; i++;
                }
                PostChunk(c, myId, myName, chunk);
            }
        }

        void PostChunk(SyncCfg c, string myId, string myName, List<KeyValuePair<string, Dictionary<string, object>>> chunk)
        {
            var body = new Dictionary<string, object>
            {
                { "player", new Dictionary<string, object> { { "id", myId }, { "name", myName } } },
                { "runs", chunk.Select(k => (object)new Dictionary<string, object>
                    { { "id", k.Value["id"] }, { "game", k.Value["game"] }, { "time", k.Value.ContainsKey("time") ? k.Value["time"] : "" }, { "results", k.Value["results"] },
                      { "net", k.Value.ContainsKey("net") ? k.Value["net"] : null } }).ToList() }
            };
            try
            {
                var r = Call(c, "POST", "/v1/runs", body);
                // runs the server refused are invalid for good (it checks them): they are marked as sent so they are not retried forever
                foreach (var k in chunk) c.Pushed.Add(k.Key);
                if (r.ContainsKey("rejected") && Convert.ToInt32(r["rejected"]) > 0) Program.Log("sync: server rejected " + r["rejected"] + " scan(s)");
            }
            catch (SyncException e)
            {
                if (e.Code != "toobig") throw;
                if (chunk.Count > 1)
                {
                    int half = chunk.Count / 2;
                    PostChunk(c, myId, myName, chunk.Take(half).ToList());
                    PostChunk(c, myId, myName, chunk.Skip(half).ToList());
                }
                else { c.Pushed.Add(chunk[0].Key); Program.Log("sync: one scan is too big for the server and was skipped: " + chunk[0].Key); }
            }
        }

        // everything newer than the cursor: friends' scans go to People\..., my own are restored if missing.
        // A scan that could not be saved because of a disk problem stops the pull there (the cursor stays before it, so it is retried).
        void Pull(SyncCfg c, string myId)
        {
            long cursor = c.Cursor;
            try
            {
                for (int guard = 0; guard < 50; guard++)
                {
                    var r = Call(c, "GET", "/v1/runs?since=" + cursor + "&limit=300", null);
                    bool stop = false;
                    foreach (object o in (object[])r["runs"])
                    {
                        var run = o as Dictionary<string, object>;
                        long seq = run != null && run.ContainsKey("seq") ? Convert.ToInt64(run["seq"]) : cursor;
                        try { if (run != null) Accept(c, myId, run); }
                        catch (IOException e) { Program.Log("sync: will retry a scan, disk problem: " + e.Message); stop = true; break; }
                        catch (UnauthorizedAccessException e) { Program.Log("sync: will retry a scan, access problem: " + e.Message); stop = true; break; }
                        catch (Exception e) { Program.Log("sync: skipped a bad run: " + e.Message); }
                        if (seq > cursor) cursor = seq;
                    }
                    if (stop || !(r["more"] is bool) || !(bool)r["more"]) break;
                }
            }
            finally { c.Cursor = cursor; }
        }

        void Accept(SyncCfg c, string myId, Dictionary<string, object> run)
        {
            var pl = (Dictionary<string, object>)run["player"];
            string pid = Convert.ToString(pl["id"]);
            string pname = CleanName(Convert.ToString(pl["name"]));
            string rid = Convert.ToString(run["id"]);
            string game = CleanName(Convert.ToString(run["game"]));
            object[] raw = (object[])run["results"];
            if (!Regex.IsMatch(pid, "^[a-f0-9]{6,16}$") || pname == "" || !SafeId(rid) || game == "" || raw.Length == 0 || raw.Length > 40) return;

            // each server row must look like one (an address that parses, plain values); anything else drops the whole scan
            var results = new List<object>();
            foreach (object ro in raw)
            {
                var row = ro as Dictionary<string, object>;
                IPAddress ip;
                if (row == null || !row.ContainsKey("ip") || !IPAddress.TryParse(Convert.ToString(row["ip"]), out ip)) return;
                results.Add(row);
            }
            if (js.Serialize(results).Length > 60000) return;

            string time = Convert.ToString(run["time"]);
            var clean = new Dictionary<string, object> { { "id", rid }, { "time", time.Length > 20 ? "" : time }, { "game", game }, { "results", results } };
            var netIn = run.ContainsKey("net") ? run["net"] as Dictionary<string, object> : null;
            if (netIn != null && netIn.ContainsKey("isp"))
                clean["net"] = new Dictionary<string, object> { { "isp", CleanLabel(Convert.ToString(netIn["isp"])) }, { "country", netIn.ContainsKey("country") ? CleanLabel(Convert.ToString(netIn["country"])) : "" } };
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
