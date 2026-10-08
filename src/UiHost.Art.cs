// UiHost part 9: the pictures of the games (cover and wide banner), taken once from the game's own store page and kept in the data folder.
//   games.json says where each game lives:  "steam": <app id>   or   "epic": "<product slug>"
//   GET /art/<GameSlug>/cover   a tall cover (about 1200 x 1800)
//   GET /art/<GameSlug>/hero    a wide banner
// The first request downloads the picture (a few seconds); later ones, also without internet, come from the cache. When there is no
// picture the answer is 404 and the page draws its own vector cover instead. Only the picture is asked for: nothing about the player is sent.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;

namespace GameNetKit
{
    public partial class UiHost
    {
        string ArtDir { get { return Path.Combine(Program.DataDir, "art"); } }
        readonly Dictionary<string, object> artLocks = new Dictionary<string, object>();
        readonly Dictionary<string, DateTime> artFailed = new Dictionary<string, DateTime>();

        object ArtLock(string key) { lock (artLocks) { object o; if (!artLocks.TryGetValue(key, out o)) { o = new object(); artLocks[key] = o; } return o; } }

        void SendArt(HttpListenerContext ctx, string path)
        {
            // /art/<slug>/<kind>
            string[] p = path.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length != 3 || !Regex.IsMatch(p[1], "^[A-Za-z0-9]{1,60}$") || (p[2] != "cover" && p[2] != "hero")) { Send(ctx, 404, "text/plain", "not found"); return; }
            string slug = p[1], kind = p[2], key = slug + "-" + kind;
            string file = Path.Combine(ArtDir, key + ".img");
            byte[] data = null;
            lock (ArtLock(key))
            {
                try { if (File.Exists(file)) data = File.ReadAllBytes(file); } catch { }
                if (data == null)
                {
                    DateTime when;
                    bool recentlyFailed;
                    lock (artFailed) recentlyFailed = artFailed.TryGetValue(key, out when) && (DateTime.Now - when).TotalMinutes < 2;
                    if (!recentlyFailed)
                    {
                        data = FetchArt(slug, kind);
                        if (data != null) { try { Directory.CreateDirectory(ArtDir); File.WriteAllBytes(file, data); } catch { } }
                        else lock (artFailed) artFailed[key] = DateTime.Now;
                    }
                }
            }
            if (data == null) { Send(ctx, 404, "text/plain", "no picture"); return; }
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = data[0] == 0x89 ? "image/png" : "image/jpeg";
            ctx.Response.Headers["Cache-Control"] = "private, max-age=86400";
            ctx.Response.ContentLength64 = data.Length;
            try { ctx.Response.OutputStream.Write(data, 0, data.Length); } catch { }
            try { ctx.Response.Close(); } catch { }
        }

        byte[] FetchArt(string slug, string kind)
        {
            try
            {
                var g = Games().FirstOrDefault(x => Program.Slug(Convert.ToString(x["name"])) == slug);
                if (g == null) return null;
                string url = null;
                try
                {
                    if (g.ContainsKey("steam")) url = SteamArtUrl(Convert.ToInt64(g["steam"]), kind);
                    else if (g.ContainsKey("epic")) url = EpicArtUrl(Convert.ToString(g["epic"]), kind);
                }
                catch (Exception e) { Program.Log("art listing " + slug + "/" + kind + ": " + e.Message); }
                byte[] img = null;
                if (url != null) { try { img = Download(url, 12 * 1024 * 1024); } catch (Exception e) { Program.Log("art download " + slug + "/" + kind + ": " + e.Message); } }
                // an older Steam app has its pictures at fixed addresses: used when the store listing does not answer
                if (img == null && g.ContainsKey("steam"))
                    foreach (string name in kind == "cover" ? new[] { "library_600x900_2x.jpg", "library_600x900.jpg" } : new[] { "library_hero.jpg", "page_bg_generated_v6b.jpg", "header.jpg" })
                        try { img = Download("https://cdn.cloudflare.steamstatic.com/steam/apps/" + Convert.ToInt64(g["steam"]) + "/" + name, 12 * 1024 * 1024); if (img != null) break; } catch { }
                if (img == null && url == null) Program.Log("art " + slug + "/" + kind + ": no source for this game");
                // only real pictures are kept (JPEG or PNG)
                if (img != null && img.Length > 2000 && ((img[0] == 0xFF && img[1] == 0xD8) || (img[0] == 0x89 && img[1] == 0x50))) return img;
            }
            catch (Exception e) { Program.Log("art " + slug + "/" + kind + ": " + e.Message); }
            return null;
        }

        // Steam's public store listing names the picture files of an app (the paths carry a hash, so they cannot be guessed)
        string SteamArtUrl(long appId, string kind)
        {
            string input = "{\"ids\":[{\"appid\":" + appId + "}],\"context\":{\"language\":\"english\",\"country_code\":\"US\"},\"data_request\":{\"include_assets\":true}}";
            byte[] raw = Download("https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=" + Uri.EscapeDataString(input), 2 * 1024 * 1024);
            if (raw == null) return null;
            var root = (Dictionary<string, object>)js.DeserializeObject(System.Text.Encoding.UTF8.GetString(raw));
            var items = (object[])((Dictionary<string, object>)root["response"])["store_items"];
            var assets = (Dictionary<string, object>)((Dictionary<string, object>)items[0])["assets"];
            string format = Convert.ToString(assets["asset_url_format"]);
            string file = Convert.ToString(assets[kind == "cover" ? "library_capsule_2x" : "library_hero_2x"]);
            if (file == "" || format == "") return null;
            return "https://shared.akamai.steamstatic.com/store_item_assets/" + format.Replace("${FILENAME}", file);
        }

        // Epic's store page of the game lists its key art; the cover is the 1200 x 1800 style one, the banner a 2560 x 1440 one
        string EpicArtUrl(string product, string kind)
        {
            if (!Regex.IsMatch(product, "^[a-z0-9-]{1,60}$")) return null;
            byte[] raw = Download("https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/" + product, 6 * 1024 * 1024);
            if (raw == null) return null;
            string text = System.Text.Encoding.UTF8.GetString(raw).Replace("\\/", "/");
            string size = kind == "cover" ? "1200x1600" : "2560x1440";
            var m = Regex.Match(text, "https://cdn2\\.unrealengine\\.com/[^\"\\\\\\s]*" + size + "[^\"\\\\\\s]*\\.jpg");
            return m.Success ? m.Value : null;
        }

        static byte[] Download(string url, int maxBytes)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 15000; req.ReadWriteTimeout = 15000; req.UserAgent = "GameNetKit/" + Program.Version;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var s = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                var buf = new byte[65536]; int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0) { ms.Write(buf, 0, n); if (ms.Length > maxBytes) return null; }
                return ms.ToArray();
            }
        }
    }
}
