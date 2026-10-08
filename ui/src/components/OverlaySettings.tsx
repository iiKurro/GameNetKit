import { useEffect, useState } from "react";
import { Keyboard, Layers, X } from "lucide-react";
import type { Settings } from "@/api";
import type { Key } from "@/i18n";
import { comboOf, parts } from "@/lib/hotkey";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  t: (k: Key) => string;
  settings: Settings;
  /** resolves to "" when done, otherwise the reason */
  onChange: (patch: Partial<Pick<Settings, "overlayKey" | "overlayCorner" | "overlayVisible">>) => Promise<string>;
}

const CORNERS = [["tl", "ovTL"], ["tr", "ovTR"], ["bl", "ovBL"], ["br", "ovBR"]] as const;

/** the in-game panel: its shortcut (click, press the keys), whether it shows now, and its corner */
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
    <div className="flex items-start gap-3 border-t border-border p-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Layers className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t("ovTitle")}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("ovDesc")}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`${t("ovTitle")}: ${value || t("ovNoKey")}`}
              onClick={() => { setProblem(""); setListening(true); }}
              onBlur={() => setListening(false)}
              className={cn(
                "flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
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
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button variant={settings.overlayVisible ? "outline" : "primary"} size="sm" onClick={() => void onChange({ overlayVisible: !settings.overlayVisible })}>
            {settings.overlayVisible ? t("ovHide") : t("ovShow")}
          </Button>
        </div>
        {problem && <p role="alert" className="mt-1.5 text-[11px] leading-relaxed text-destructive">{problem}</p>}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("ovPlace")}>
          <span className="text-xs text-muted-foreground">{t("ovPlace")}:</span>
          {CORNERS.map(([k, label]) => (
            <button
              key={k} type="button" role="radio" aria-checked={settings.overlayCorner === k}
              onClick={() => void onChange({ overlayCorner: k })}
              className={cn(
                "h-7 cursor-pointer rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                settings.overlayCorner === k ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
