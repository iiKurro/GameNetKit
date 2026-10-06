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
                var s = new Dictionary<string, object> { { "guardAuto", false }, { "background", true }, { "startup", false }, { "notify", true }, { "sound", true } };
                try
                {
                    if (File.Exists(SettingsPath))
                    {
                        var d = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(SettingsPath));
                        foreach (string k in new[] { "guardAuto", "background", "startup", "notify", "sound" })
                            if (d.ContainsKey(k) && d[k] is bool) s[k] = d[k];
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
            return s;
        }

        object SettingsSet(Dictionary<string, object> body)
        {
            var s = ReadSettings();

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
