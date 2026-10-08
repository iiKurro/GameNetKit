// UiHost part 5: remembered settings (guard on/off, background, start with Windows).
//   guardAuto   the guard is started again every time the app starts (it follows what you last chose: start = on, stop = off)
//   background  closing the window keeps the guard running (light, no window). Off = closing the window also stops the guard.
//   startup     a scheduled task starts the guard at sign-in, silently (needs one admin approval to set up; implies the two above)
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace GameNetKit
{
    public partial class UiHost
    {
        string SettingsPath { get { return Path.Combine(Program.DataDir, "settings.json"); } }
        readonly object settingsLock = new object();

        Dictionary<string, object> ReadSettings()
        {
            lock (settingsLock)
            {
                var s = new Dictionary<string, object> { { "guardAuto", false }, { "background", true }, { "startup", false }, { "notify", true }, { "sound", true },
                    { "overlayKey", OverlayLive.DefaultKey }, { "overlayCorner", "tr" }, { "regionLock", new Dictionary<string, object>() } };
                try
                {
                    if (File.Exists(SettingsPath))
                    {
                        var d = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(SettingsPath));
                        foreach (string k in new[] { "guardAuto", "background", "startup", "notify", "sound" })
                            if (d.ContainsKey(k) && d[k] is bool) s[k] = d[k];
                        if (d.ContainsKey("regionLock") && d["regionLock"] is Dictionary<string, object>) s["regionLock"] = d["regionLock"];
                        if (d.ContainsKey("overlayKey") && d["overlayKey"] is string) s["overlayKey"] = d["overlayKey"];
                        if (d.ContainsKey("overlayCorner") && d["overlayCorner"] is string && IsCorner((string)d["overlayCorner"])) s["overlayCorner"] = d["overlayCorner"];
                    }
                }
                catch { }
                return s;
            }
        }

        void WriteSettings(Dictionary<string, object> s)
        {
            lock (settingsLock)
            {
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(SettingsPath, js.Serialize(s), new UTF8Encoding(false));
            }
        }

        bool Setting(string key) { return (bool)ReadSettings()[key]; }

        void Remember(string key, bool value)
        {
            var s = ReadSettings();
            s[key] = value;
            WriteSettings(s);
        }

        // task existence is cached for a few seconds: the page polls the guard state
        DateTime taskCheckedAt = DateTime.MinValue;
        bool taskExists;
        bool TaskInstalled()
        {
            if (Demo) return false;
            if ((DateTime.Now - taskCheckedAt).TotalSeconds > 15) { taskExists = GuardInstall.TaskExists(); taskCheckedAt = DateTime.Now; }
            return taskExists;
        }

        object SettingsGet()
        {
            var s = ReadSettings();
            s["taskInstalled"] = TaskInstalled();
            // listed in Task Manager > Startup apps, and switched off there by the user?
            s["startupDisabled"] = !Demo && TaskInstalled() && StartupEntry.DisabledByUser();
            s["overlayVisible"] = Overlay.Visible;
            return s;
        }

        static bool IsCorner(string c) { return c == "tl" || c == "tr" || c == "bl" || c == "br"; }

        // the saved shortcut and corner of the panel over the game, put in place when the tray thread is ready
        void ApplyOverlaySettings()
        {
            var s = ReadSettings();
            Overlay.Corner = (string)s["overlayCorner"];
            OverlayLive.Commands = OverlayCommands;
            Overlay.StatusHint = OverlayLive.L("ovHudHint"); Overlay.MenuHint = OverlayLive.L("ovMenuHint");
            string why = OverlayLive.SetKey((string)s["overlayKey"]);
            if (why != "") Program.Log("overlay shortcut " + s["overlayKey"] + ": " + why);
        }

        // true (and the reason) when the shortcut could not be set
        object OverlaySet(Dictionary<string, object> body, Dictionary<string, object> s)
        {
            if (body.ContainsKey("overlayKey") && body["overlayKey"] is string)
            {
                string key = (string)body["overlayKey"];
                string why = Tray.Invoke(() => OverlayLive.SetKey(key));
                if (why != "")
                {
                    Tray.Invoke(() => OverlayLive.SetKey((string)s["overlayKey"]));      // the previous one stays
                    return Fail("overlay-" + why);
                }
                s["overlayKey"] = key; WriteSettings(s);
            }
            if (body.ContainsKey("overlayCorner") && body["overlayCorner"] is string && IsCorner((string)body["overlayCorner"]))
            {
                s["overlayCorner"] = body["overlayCorner"]; WriteSettings(s);
                Overlay.Corner = (string)s["overlayCorner"];
                Tray.Invoke(() => { Overlay.Refresh(); return ""; });
            }
            if (body.ContainsKey("overlayVisible") && body["overlayVisible"] is bool)
            {
                bool v = (bool)body["overlayVisible"];
                string why = Tray.Invoke(() => { OverlayLive.SetVisible(v); return ""; });
                if (why != "") return Fail("overlay-" + why);
            }
            return null;
        }

        object SettingsSet(Dictionary<string, object> body)
        {
            var s = ReadSettings();

            var ov = OverlaySet(body, s);
            if (ov != null) return ov;
            s = ReadSettings();

            if (body.ContainsKey("background") && body["background"] is bool)
            {
                bool v = (bool)body["background"];
                // "start with Windows" needs the background guard: turning background off turns that off as well
                if (!v && (bool)s["startup"]) { var r = SetStartup(false); if (!(bool)r["ok"]) return r; s = ReadSettings(); }
                s["background"] = v;
                WriteSettings(s);
            }

            if (body.ContainsKey("startup") && body["startup"] is bool)
            {
                var r = SetStartup((bool)body["startup"]);
                if (!(bool)r["ok"]) return r;
            }

            // region lock: { "<game>": true|false } for one or more games; the guard picks it up within a couple of seconds
            if (body.ContainsKey("regionLock") && body["regionLock"] is Dictionary<string, object>)
            {
                var rl = new Dictionary<string, object>((Dictionary<string, object>)s["regionLock"]);
                foreach (var kv in (Dictionary<string, object>)body["regionLock"])
                    if (kv.Value is bool && kv.Key.Length > 0 && kv.Key.Length < 80) { if ((bool)kv.Value) rl[kv.Key] = true; else rl.Remove(kv.Key); }
                s["regionLock"] = rl;
                WriteSettings(s);
            }

            foreach (string k in new[] { "notify", "sound" })
                if (body.ContainsKey(k) && body[k] is bool) Remember(k, (bool)body[k]);

            if (body.ContainsKey("guardAuto") && body["guardAuto"] is bool)
            {
                bool v = (bool)body["guardAuto"];
                if (v) { if (!GuardRunning()) { string why = StartGuard(true); if (why != "") return Fail(why); } else Remember("guardAuto", true); }
                else { StopGuard(); Remember("guardAuto", false); if (Setting("startup")) { var r = SetStartup(false); if (!(bool)r["ok"]) return r; } }
            }
            return SettingsGet();
        }

        // installs / removes the sign-in task (one admin prompt)
        Dictionary<string, object> SetStartup(bool on)
        {
            if (Demo) { Remember("startup", on); if (on) { Remember("background", true); Remember("guardAuto", true); } return Ok(); }
            int rc = on
                ? RunElevated("--install-guard 1 --user \"" + Environment.UserDomainName + "\\" + Environment.UserName + "\"")
                : RunElevated("--uninstall-guard 1");
            taskCheckedAt = DateTime.MinValue;
            if (rc == -1) return Fail("uac");
            if (rc != 0) return FwFail("startup", FwWhy(rc));
            if (on && !TaskInstalled()) return FwFail("startup", "the task was not created");
            if (on) StartupEntry.Ensure(); else StartupEntry.Remove();
            Remember("startup", on);
            if (on) { Remember("background", true); Remember("guardAuto", true); }
            return Ok();
        }

        // true when the installed copy of the guard is older than this app (after an update)
        object GuardInstallUpdate()
        {
            if (Demo || !TaskInstalled()) return Fail("not installed");
            int rc = RunElevated("--install-guard 1 --user \"" + Environment.UserDomainName + "\\" + Environment.UserName + "\"");
            if (rc == -1) return Fail("uac");
            if (rc != 0) return FwFail("startup", FwWhy(rc));
            StartupEntry.Ensure();
            return Ok();
        }
    }
}
