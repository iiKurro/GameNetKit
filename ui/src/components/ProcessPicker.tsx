import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { api, type ProcessRow } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  game: string;
  /** the player picked a program: resolves when it was saved (the scan is restarted by the caller) */
  onPick: (processName: string) => Promise<void>;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

/**
 * "The game is running but the app does not see it": lists the running programs that could be the game (they own UDP ports or a
 * window, biggest first), the likeliest one marked. Picking one remembers it for that game, for the scan and for the guard.
 */
export function ProcessPicker({ t, game, onPick, onClose }: Props) {
  const [rows, setRows] = useState<ProcessRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await api.processes().catch(() => null);
    if (!r) { setFailed(true); setRows([]); return; }
    setRows(r);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; before?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (name: string) => {
    setBusy(name);
    try { await onPick(name); } finally { setBusy(""); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div ref={box} className="enter flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 id="picker-title" className="text-base font-bold">{t("pickerTitle")} · {game}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("pickerHint")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => void load()} aria-label={t("retry")}><RefreshCw /></Button>
            <Button variant="ghost" size="sm" className="size-8 px-0" onClick={onClose} aria-label={t("closeLabel")}><X /></Button>
          </div>
        </div>

        <div className="overflow-y-auto p-3">
          {rows === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground" aria-busy="true">{t("loading")}</p>
          ) : failed ? (
            <p className="p-6 text-center text-sm text-destructive">{t("errGeneric")}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("pickerNone")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <li key={r.name}>
                  <button
                    disabled={!!busy}
                    onClick={() => void pick(r.name)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-start transition-colors disabled:cursor-default disabled:opacity-60",
                      r.suggested ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent",
                    )}
                  >
                    {busy === r.name ? <LoaderCircle className="size-5 shrink-0 animate-spin" /> : <Gamepad2 className={cn("size-5 shrink-0", r.suggested ? "text-primary" : "text-muted-foreground")} />}
                    <span className="min-w-0 flex-1">
                      <span className="num block truncate text-sm font-semibold">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.title || "—"}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
                      {r.suggested && <span className="inline-flex items-center gap-1 font-semibold text-primary"><Sparkles className="size-3" /> {t("pickerSuggested")}</span>}
                      <span className="num">{r.udp} UDP · {r.mb} MB</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
