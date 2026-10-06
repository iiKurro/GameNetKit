import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell, Cloud, Copy, KeyRound, Minimize2, MonitorUp, Moon, Settings2, ShieldCheck, Volume2 } from "lucide-react";
import type { Density } from "@/lib/prefs";
import type { Settings, SyncState } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type T = (k: Key) => string;

interface Props {
  t: T;
  settings: Settings;
  /** which row is waiting for an answer (an admin prompt can take a while) */
  busyKey: string;
  onChange: (key: "guardAuto" | "background" | "startup" | "notify" | "sound", value: boolean) => void;
  /** sharing with the group (null until the first answer) */
  sync: SyncState | null;
  onSyncToggle: (enabled: boolean) => void;
  onChangeCode: () => void;
  density: Density;
  onDensity: (d: Density) => void;
  /** copies the diagnostics text; resolves to "" when done, otherwise a message */
  onDiagnostics: () => Promise<string>;
  /** show the welcome scenes again */
  onWelcome: () => void;
}

/** Start-up choices, kept in one small panel in the header so they are one click away but never in the way. */
export function SettingsPopover({ t, settings, busyKey, onChange, sync, onSyncToggle, onChangeCode, density, onDensity, onDiagnostics, onWelcome }: Props) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const copyDiag = async () => {
    setDiag("busy");
    const err = await onDiagnostics();
    setDiag(err ? "fail" : "done");
    setTimeout(() => setDiag("idle"), 4000);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const rows: { key: "guardAuto" | "background" | "startup" | "notify" | "sound"; icon: typeof Moon; title: Key; desc: Key; value: boolean; locked?: boolean }[] = [
    { key: "notify", icon: Bell, title: "notifyTitle", desc: "notifyDesc", value: settings.notify },
    { key: "sound", icon: Volume2, title: "soundTitle", desc: "soundTitle", value: settings.sound, locked: !settings.notify },
    { key: "guardAuto", icon: ShieldCheck, title: "setGuardTitle", desc: "setGuardDesc", value: settings.guardAuto },
    { key: "background", icon: Moon, title: "setBgTitle", desc: "setBgDesc", value: settings.background, locked: settings.startup },
    { key: "startup", icon: MonitorUp, title: "setStartTitle", desc: "setStartDesc", value: settings.startup },
  ];

  return (
    <div ref={wrap} className="relative">
      <Button ref={trigger} variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Settings2 /> {t("settingsTitle")}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t("settingsTitle")}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top" }}
            className="absolute end-0 top-full z-40 mt-2 w-[min(92vw,390px)] rounded-xl border border-border bg-card p-2 lift"
          >
            {sync?.configured && (
              <div className="flex items-start gap-3 border-b border-border p-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Cloud className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div id="set-sync" className="text-sm font-medium">{t("syncTitle")}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("syncDesc")}</p>
                  <p className={cn("mt-2 text-xs", sync.error ? "text-warning" : "text-muted-foreground")}>
                    {!sync.hasCode ? t("syncNoCode")
                      : !sync.enabled ? t("syncOff")
                      : sync.error === "code" ? t("syncErrCode")
                      : sync.error === "full" ? t("syncErrFull")
                      : sync.error === "taken" ? t("syncErrTaken")
                      : sync.error === "player" ? t("syncErrPlayer")
                      : sync.error === "net" ? t("syncErrNet")
                      : sync.error ? t("syncErrServer")
                      : sync.lastOkSecondsAgo < 0 ? t("checking")
                      : (
                        <>
                          <span className="text-success">{t("syncOk")}</span> · {t("syncAgo")} <span className="num">{sync.lastOkSecondsAgo}</span> {t("syncSec")} ·{" "}
                          <span className="num">{sync.players}</span> {t("syncPlayers")} · <span className="num">{sync.uploaded}</span> {t("syncUploaded")}
                        </>
                      )}
                  </p>
                  <Button className="mt-2" variant="outline" size="sm" onClick={() => { setOpen(false); onChangeCode(); }}>
                    <KeyRound /> {sync.hasCode ? t("syncChangeCode") : t("syncEnterCode")}
                  </Button>
                </div>
                <Switch
                  checked={sync.enabled}
                  disabled={!sync.hasCode}
                  aria-labelledby="set-sync"
                  onChange={(v) => onSyncToggle(v)}
                />
              </div>
            )}
            <ul className="flex flex-col">
              {rows.map((r, i) => {
                const Icon = r.icon;
                return (
                  <li key={r.key} className={cn("flex items-start gap-3 p-3", i > 0 && "border-t border-border")}>
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div id={`set-${r.key}`} className="text-sm font-medium">{t(r.title)}</div>
                      {r.desc !== r.title && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(r.desc)}</p>}
                      {r.key === "startup" && r.value && (
                        <p className={cn("mt-1.5 text-xs leading-relaxed", settings.startupDisabled ? "text-warning" : "text-muted-foreground")}>
                          {settings.startupDisabled ? t("setStartOffByUser") : t("setStartListed")}
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={r.value}
                      busy={busyKey === r.key}
                      disabled={!!busyKey || r.locked}
                      aria-labelledby={`set-${r.key}`}
                      onChange={(v) => onChange(r.key, v)}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex items-start gap-3 border-t border-border p-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Minimize2 className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div id="set-density" className="text-sm font-medium">{t("densityTitle")}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("densityDesc")}</p>
              </div>
              <Switch checked={density === "compact"} aria-labelledby="set-density" onChange={(v) => onDensity(v ? "compact" : "comfortable")} />
            </div>
            <div className="flex items-center gap-3 border-t border-border p-3">
              <Button variant="outline" size="sm" onClick={copyDiag} disabled={diag === "busy"}><Copy /> {t("copyDiag")}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onWelcome(); }}>{t("welcomeAgain")}</Button>
              {diag === "done" && <span role="status" className="text-xs text-success">{t("diagDone")}</span>}
              {diag === "fail" && <span role="status" className="text-xs text-destructive">{t("copyFail")}</span>}
            </div>
            <p className="border-t border-border px-3 pt-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
              {settings.taskInstalled ? t("setNoteInstalled") : t("setNoteAdmin")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
