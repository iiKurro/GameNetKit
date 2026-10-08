// UiHost part 8: the commands of the in-game menu (the overlay's second step). Each one is something the window can already do,
// started from the keyboard: a new scan of the game of the latest scan (the overlay shows the live ping; the scan is its only command).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace GameNetKit
{
    public partial class UiHost
    {
        static readonly Color MenuWhite = Color.FromArgb(232, 237, 243), MenuRed = Color.FromArgb(239, 83, 80);

        List<OverlayItem> OverlayCommands()
        {
            var items = new List<OverlayItem>();
            string game = OverlayLive.CurrentGame;

            items.Add(new OverlayItem("1   " + OverlayLive.L("ovCmdScan"), MenuWhite, () =>
            {
                if (game == "") { Overlay.Flash(OverlayLive.L("ovNone")); return; }
                Overlay.Flash(FlashOf(Start(new Dictionary<string, object> { { "game", game } })));
            }));
            return items;
        }

        // the answer of a window command as one short line for the panel
        static string FlashOf(object r)
        {
            var d = r as Dictionary<string, object>;
            if (d == null || !d.ContainsKey("ok")) return OverlayLive.L("ovDone");
            if (Convert.ToBoolean(d["ok"])) return OverlayLive.L("ovDone");
            string err = d.ContainsKey("error") ? Convert.ToString(d["error"]) : "";
            return err == "uac" ? OverlayLive.L("ovUac") : err == "busy" ? OverlayLive.L("ovBusy") : OverlayLive.L("ovFail");
        }
    }
}
