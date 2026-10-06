import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Cloud, KeyRound, LoaderCircle, MonitorUp, Moon, Settings2, ShieldCheck, Trash2 } from "lucide-react";
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
  onChange: (key: "guardAuto" | "background" | "startup", value: boolean) => void;
  /** sharing with the group (null until the first answer) */
  sync: SyncState | null;
  onSyncToggle: (enabled: boolean) => void;
  onChangeCode: () => void;
  /** deletes my scans from the group server; resolves to "" when done, otherwise a message */
  onDeleteMine: () => Promise<string>;
}

/** Start-up choices, kept in one small panel in the header so they are one click away but never in the way. */
export function SettingsPopover({ t, settings, busyKey, onChange, sync, onSyncToggle, onChangeCode, onDeleteMine }: Props) {
  const [open, setOpen] = useState(false);
  // "delete my scans from the server": two clicks, and it says what happened
  const [delStep, setDelStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [delMsg, setDelMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (delStep !== "confirm") return;
    const id = setTimeout(() => setDelStep("idle"), 5000);
    return () => clearTimeout(id);
  }, [delStep]);
  const deleteMine = async () => {
    if (delStep === "idle") { setDelMsg(null); setDelStep("confirm"); return; }
    if (delStep !== "confirm") return;
    setDelStep("busy");
    const err = await onDeleteMine();
    setDelMsg(err ? { ok: false, text: err } : { ok: true, text: t("syncDelDone") });
    setDelStep("idle");
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

  const rows: { key: "guardAuto" | "background" | "startup"; icon: typeof Moon; title: Key; desc: Key; value: boolean; locked?: boolean }[] = [
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
            className="absolute end-0 top-full z-40 mt-2 w-[min(92vw,390px)] rounded-xl border border-border bg-card p-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setOpen(false); onChangeCode(); }}>
                      <KeyRound /> {sync.hasCode ? t("syncChangeCode") : t("syncEnterCode")}
                    </Button>
                    {sync.hasCode && (
                      <Button variant={delStep === "confirm" ? "destructive" : "ghost"} size="sm" disabled={delStep === "busy"} onClick={deleteMine}>
                        {delStep === "busy" ? <LoaderCircle className="animate-spin" /> : <Trash2 />} {delStep === "confirm" ? t("syncDelConfirm") : t("syncDelBtn")}
                      </Button>
                    )}
                  </div>
                  {delStep === "confirm" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("syncDelHint")}</p>}
                  {delMsg && <p role="status" className={cn("mt-2 text-xs", delMsg.ok ? "text-success" : "text-destructive")}>{delMsg.text}</p>}
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
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(r.desc)}</p>
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
            <p className="border-t border-border px-3 pt-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
              {settings.taskInstalled ? t("setNoteInstalled") : t("setNoteAdmin")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
