import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import type { Settings } from "@/api";
import type { Key } from "@/i18n";
import { comboOf, parts } from "@/lib/hotkey";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SettingGroup, SettingRow } from "@/components/SettingRow";

interface Props {
  t: (k: Key) => string;
  settings: Settings;
  /** resolves to "" when done, otherwise the reason */
  onChange: (patch: Partial<Pick<Settings, "overlayKey" | "overlayCorner" | "overlayVisible">>) => Promise<string>;
}

const CORNERS = [
  { id: "tl", label: "ovTL", pos: "start-2 top-2" },
  { id: "tr", label: "ovTR", pos: "end-2 top-2" },
  { id: "bl", label: "ovBL", pos: "start-2 bottom-2" },
  { id: "br", label: "ovBR", pos: "end-2 bottom-2" },
] as const;

/** the in-game panel: its shortcut (click it, press the keys), showing it now, and which corner of the screen it sits in */
export function OverlaySettings({ t, settings, onChange }: Props) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const value = settings.overlayKey;

  const setKey = async (combo: string) => {
    const why = await onChange({ overlayKey: combo });
    setProblem(!why ? "" : why.endsWith("taken") ? t("ovErrTaken") : why.endsWith("needmod") ? t("ovErrNeedmod") : t("ovErrGeneric"));
  };

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setListening(false); return; }
      const combo = comboOf(e);
      if (!combo) return;                          // only a modifier so far: keep waiting
      setListening(false);
      void setKey(combo);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return (
    <div className="flex flex-col gap-4">
      <SettingGroup>
        <SettingRow
          title={t("svOvKeyTitle")}
          hint={t("svOvKeyHint")}
          control={
            <>
              <button
                type="button"
                aria-label={`${t("svOvKeyTitle")}: ${value || t("ovNoKey")}`}
                onClick={() => { setProblem(""); setListening(true); }}
                onBlur={() => setListening(false)}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
                  listening ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted hover:border-primary/40",
                )}
              >
                {listening ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold"><Keyboard className="size-4" /> {t("ovPress")}</span>
                ) : value ? (
                  <span className="num flex items-center gap-1" dir="ltr">
                    {parts(value).map((p, i) => (
                      <kbd key={i} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-semibold text-foreground">{p}</kbd>
                    ))}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("ovNoKey")}</span>
                )}
              </button>
              {value && !listening && (
                <button
                  type="button" aria-label={t("ovRemove")}
                  onClick={() => { setProblem(""); void setKey(""); }}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <X className="size-4" />
                </button>
              )}
            </>
          }
        >
          {problem && <span role="alert" className="text-destructive">{problem}</span>}
        </SettingRow>

        <SettingRow
          title={t("svOvShowTitle")}
          control={
            <Button variant={settings.overlayVisible ? "outline" : "primary"} size="sm" onClick={() => void onChange({ overlayVisible: !settings.overlayVisible })}>
              {settings.overlayVisible ? t("ovHide") : t("ovShow")}
            </Button>
          }
        />

        <SettingRow
          title={t("svOvCornerTitle")}
          control={
            // a tiny screen: the panel's corner is picked by touching that corner (left and right here are the real screen sides)
            <div dir="ltr" role="radiogroup" aria-label={t("svOvCornerTitle")} className="relative h-[76px] w-32 rounded-lg border border-border bg-background">
              {CORNERS.map((c) => {
                const on = settings.overlayCorner === c.id;
                const side = c.id.endsWith("l") ? "left-2" : "right-2", edge = c.id.startsWith("t") ? "top-2" : "bottom-2";
                return (
                  <button
                    key={c.id}
                    type="button" role="radio" aria-checked={on} aria-label={t(c.label)} title={t(c.label)}
                    onClick={() => void onChange({ overlayCorner: c.id })}
                    className={cn(
                      "absolute h-5 w-9 cursor-pointer rounded-[5px] border transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
                      side, edge,
                      on ? "border-primary bg-primary/25" : "border-border bg-muted hover:border-primary/50",
                    )}
                  />
                );
              })}
            </div>
          }
        />
      </SettingGroup>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("svOvNote")}</p>
    </div>
  );
}
