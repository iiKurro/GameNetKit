// UiHost part 3: who is using this copy (profile), importing friends' exports, and exporting everything.
//
// There is no server and no sign-in: a "profile" is just a name you choose plus a random id (used to tell two people with
// the same name apart and to avoid importing the same file twice). Layout on disk:
//   profile.json                                  this PC's player
//   History\<Game>\*.json                         my scans (see UiHost.Extra.cs)
//   People\<Name>_<id>\person.json                a friend imported from an export file
//   People\<Name>_<id>\<Game>\*.json              that friend's scans, kept apart from mine
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace GameNetKit
{
    public partial class UiHost
    {
        string PeopleRoot { get { return Path.Combine(Program.DataDir, Demo ? "People-demo" : "People"); } }
        string ProfilePath { get { return Path.Combine(Program.DataDir, "profile.json"); } }

        string PersonOf(Dictionary<string, object> body)
        {
            string p = body.ContainsKey("person") ? Convert.ToString(body["person"]) : "";
            return SafeId(p) ? p : "";
        }

        static string CleanName(string s)
        {
            s = Regex.Replace(s ?? "", @"[\p{C}<>""'\\/:*?|]", "").Trim();
            return s.Length > 24 ? s.Substring(0, 24).Trim() : s;
        }

        static string NewId()
        {
            var b = new byte[4];
            using (var r = RandomNumberGenerator.Create()) r.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        Dictionary<string, object> ReadProfile()
        {
            try
            {
                if (File.Exists(ProfilePath))
                {
                    var p = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(ProfilePath));
                    if (p.ContainsKey("name") && p.ContainsKey("id") && CleanName(Convert.ToString(p["name"])) != "") return p;
                }
            }
            catch { }
            return null;
        }

        object ProfileGet()
        {
            var p = ReadProfile();
            return new Dictionary<string, object>
            {
                { "name", p != null ? p["name"] : "" }, { "id", p != null ? p["id"] : "" },
                { "suggested", CleanName(Environment.UserName) }, { "dataDir", Program.DataDir }
            };
        }

        object ProfileSet(Dictionary<string, object> body)
        {
            string name = CleanName(body.ContainsKey("name") ? Convert.ToString(body["name"]) : "");
            if (name == "") return Fail("name");
            var old = ReadProfile();
            string id = old != null ? Convert.ToString(old["id"]) : NewId();
            Directory.CreateDirectory(Program.DataDir);
            File.WriteAllText(ProfilePath, js.Serialize(new Dictionary<string, object> { { "name", name }, { "id", id } }), new UTF8Encoding(false));
            return ProfileGet();
        }

        // ------------------------------------------------------------------ friends
        object PeopleList()
        {
            var list = new List<Dictionary<string, object>>();
            if (!Directory.Exists(PeopleRoot)) return list;
            foreach (string dir in Directory.GetDirectories(PeopleRoot))
            {
                string slug = Path.GetFileName(dir);
                string pj = Path.Combine(dir, "person.json");
                if (!SafeId(slug) || !File.Exists(pj)) continue;
                var info = LoadRun(pj);
                if (info == null) continue;
                var counts = new Dictionary<string, object>();
                int total = 0;
                foreach (var g in Games())
                {
                    string gd = Path.Combine(dir, Program.Slug((string)g["name"]));
                    int n = Directory.Exists(gd) ? Directory.GetFiles(gd, "*.json").Length : 0;
                    counts[(string)g["name"]] = n; total += n;
                }
                list.Add(new Dictionary<string, object>
                {
                    { "slug", slug }, { "name", info["name"] }, { "id", info["id"] },
                    { "importedAt", info.ContainsKey("importedAt") ? info["importedAt"] : "" }, { "counts", counts }, { "total", total }
                });
            }
            return list.OrderBy(p => Convert.ToString(p["name"])).ToList();
        }

        // Imports an export file made by another GameNetKit (single game or all games). Everything in it is treated as untrusted
        // text/numbers: ids are checked, nothing is executed, and it can never overwrite my own history.
        object PeopleImport(Dictionary<string, object> body)
        {
            string content = body.ContainsKey("content") ? Convert.ToString(body["content"]) : "";
            if (content.Length == 0 || content.Length > 30 * 1024 * 1024) return Fail("bad size");
            Dictionary<string, object> doc;
            try { doc = (Dictionary<string, object>)js.DeserializeObject(content); } catch (Exception e) { return Fail("bad json: " + e.Message); }
            if (!doc.ContainsKey("app") || Convert.ToString(doc["app"]) != "GameNetKit") return Fail("bad app");
            var pl = doc.ContainsKey("player") ? doc["player"] as Dictionary<string, object> : null;
            if (pl == null || !pl.ContainsKey("name") || !pl.ContainsKey("id")) return Fail("no player");
            string name = CleanName(Convert.ToString(pl["name"]));
            string id = Convert.ToString(pl["id"]);
            if (name == "" || !Regex.IsMatch(id, "^[a-f0-9]{6,16}$")) return Fail("no player");
            var me = ReadProfile();
            if (me != null && Convert.ToString(me["id"]) == id) return Fail("own file");

            var runs = new List<Dictionary<string, object>>();
            try
            {
                if (doc.ContainsKey("games"))
                {
                    foreach (var kv in (Dictionary<string, object>)doc["games"])
                        foreach (object o in (object[])kv.Value)
                        {
                            var r = (Dictionary<string, object>)o;
                            if (!r.ContainsKey("game")) r["game"] = kv.Key;
                            runs.Add(r);
                        }
                }
                else if (doc.ContainsKey("runs"))
                {
                    string g = doc.ContainsKey("game") ? Convert.ToString(doc["game"]) : "";
                    foreach (object o in (object[])doc["runs"])
                    {
                        var r = (Dictionary<string, object>)o;
                        if (!r.ContainsKey("game")) r["game"] = g;
                        runs.Add(r);
                    }
                }
            }
            catch (Exception e) { return Fail("bad runs: " + e.Message); }
            if (runs.Count == 0 || runs.Count > 5000) return Fail("bad runs");

            string slug = Program.Slug(name) + "_" + id;
            string dir = Path.Combine(PeopleRoot, slug);
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "person.json"), js.Serialize(new Dictionary<string, object>
            {
                { "name", name }, { "id", id }, { "importedAt", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) }
            }), new UTF8Encoding(false));

            int saved = 0;
            foreach (var r in runs)
            {
                try
                {
                    string rid = Convert.ToString(r["id"]);
                    string game = CleanName(Convert.ToString(r["game"]));
                    object[] results = (object[])r["results"];
                    if (!SafeId(rid) || game == "" || results.Length > 40) continue;
                    string gdir = Path.Combine(dir, Program.Slug(game));
                    Directory.CreateDirectory(gdir);
                    var clean = new Dictionary<string, object>
                    {
                        { "id", rid }, { "time", Convert.ToString(r["time"]).Length > 20 ? "" : Convert.ToString(r["time"]) },
                        { "game", game }, { "results", results }
                    };
                    File.WriteAllText(Path.Combine(gdir, rid + ".json"), js.Serialize(clean), new UTF8Encoding(false));
                    saved++;
                }
                catch { }
            }
            if (saved == 0) return Fail("bad file");
            return new Dictionary<string, object> { { "ok", true }, { "name", name }, { "runs", saved }, { "slug", slug } };
        }

        object PeopleDelete(Dictionary<string, object> body)
        {
            string slug = body.ContainsKey("slug") ? Convert.ToString(body["slug"]) : "";
            if (!SafeId(slug)) return Fail("bad id");
            string dir = Path.Combine(PeopleRoot, slug);
            if (Directory.Exists(dir)) { try { Directory.Delete(dir, true); } catch { return Fail("busy"); } }
            return Ok();
        }

        // ------------------------------------------------------------------ export everything (split by game, tagged with who it is)
        object HistoryExportAll()
        {
            var me = ReadProfile();
            if (me == null) return Fail("no profile");
            Migrate();
            var games = new Dictionary<string, object>();
            int total = 0;
            foreach (var g in Games())
            {
                string name = (string)g["name"];
                string hd = HistoryDirFor(Program.Slug(name));
                if (!Directory.Exists(hd)) continue;
                var runs = new List<object>();
                foreach (string f in Directory.GetFiles(hd, "*.json").OrderBy(x => x))
                {
                    var run = LoadRun(f);
                    if (run != null) runs.Add(run);
                }
                if (runs.Count > 0) { games[name] = runs; total += runs.Count; }
            }
            string dir = Path.Combine(Program.DataDir, "Exports");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "GameNetKit_" + Program.Slug(Convert.ToString(me["name"])) + "_ALL_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".json");
            var doc = new Dictionary<string, object>
            {
                { "app", "GameNetKit" }, { "version", Program.Version },
                { "player", new Dictionary<string, object> { { "name", me["name"] }, { "id", me["id"] } } },
                { "exported", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) }, { "games", games }
            };
            File.WriteAllText(path, js.Serialize(doc), new UTF8Encoding(false));
            if (!Demo) { try { Process.Start("explorer.exe", "/select,\"" + path + "\""); } catch { } }
            return new Dictionary<string, object> { { "ok", true }, { "path", path }, { "count", total }, { "games", games.Count } };
        }

        void OpenData()
        {
            Directory.CreateDirectory(Program.DataDir);
            Process.Start("explorer.exe", "\"" + Program.DataDir + "\"");
        }
    }
}
