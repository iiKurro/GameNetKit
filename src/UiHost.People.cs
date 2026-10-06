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

        object PeopleDelete(Dictionary<string, object> body)
        {
            string slug = body.ContainsKey("slug") ? Convert.ToString(body["slug"]) : "";
            if (!SafeId(slug)) return Fail("bad id");
            string dir = Path.Combine(PeopleRoot, slug);
            if (Directory.Exists(dir)) { try { Directory.Delete(dir, true); } catch { return Fail("busy"); } }
            return Ok();
        }
    }
}
