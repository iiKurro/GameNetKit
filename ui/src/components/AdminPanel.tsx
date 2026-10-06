import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, KeyRound, LoaderCircle, Lock, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { api, type AdminPlayer, type AdminRun } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  /** this PC already has the admin code */
  unlocked: boolean;
  onUnlocked: () => void;
  onLocked: () => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Group admin: opened with Ctrl+Shift+A, which nothing in the interface points at. It asks for the admin code once; with it you see
 * every player of the group and can remove their scans from the server (all of them, or one game). Without the code the server
 * refuses every call, so the panel is useless to anyone else even if they find it.
 */
export function AdminPanel({ t, unlocked, onUnlocked, onLocked, onClose }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [confirm, setConfirm] = useState("");   // "<player>|<game or *>"
  const [note, setNote] = useState("");
  // one player's individual scans, loaded when their list is opened
  const [openId, setOpenId] = useState("");
  const [runs, setRuns] = useState<AdminRun[] | null>(null);
  const resetPassword = async (p: AdminPlayer) => {
    const key = p.id + "|reset";
    if (confirm !== key) { setConfirm(key); setNote(""); return; }
    setConfirm(""); setBusy(true); setProblem("");
    const r = await api.adminReset(p.id).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) { setProblem(t("adminFail")); return; }
    setNote(`${p.name}: ${t("adminResetDone")}`);
    await load();
  };
  const showRuns = async (p: AdminPlayer) => {
    if (openId === p.id) { setOpenId(""); setRuns(null); return; }
    setOpenId(p.id); setRuns(null); setProblem("");
    const r = await api.adminRuns(p.id).catch(() => null);
    if (!r || r.error) { setProblem(r?.error === "admin" ? t("adminBadCode") : t("adminFail")); return; }
    setRuns(r.runs ?? []);
  };
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setProblem("");
    const r = await api.adminPlayers().catch(() => null);
    if (!r) { setProblem(t("adminFail")); return; }
    if (r.error === "admin") { onLocked(); setPlayers(null); setProblem(t("adminBadCode")); return; }
    if (r.error) { setProblem(t("adminFail")); return; }
    setPlayers(r.players ?? []);
  }, [t, onLocked]);

  useEffect(() => { if (unlocked) void load(); }, [unlocked, load]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
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

  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(""), 5000);
    return () => clearTimeout(id);
  }, [confirm]);

  const unlock = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setProblem("");
    const r = await api.adminUnlock(code.trim()).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) { setProblem(r?.error === "admin" ? t("adminBadCode") : r?.error === "code" ? t("syncErrCode") : t("adminFail")); return; }
    setCode("");
    onUnlocked();
  };

  const remove = async (p: AdminPlayer, game: string, run = "") => {
    const key = p.id + "|" + (run ? "run:" + game + ":" + run : game || "*");
    if (confirm !== key) { setConfirm(key); setNote(""); return; }
    setConfirm(""); setBusy(true); setProblem("");
    const r = await api.adminDelete(p.id, game, run).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) { setProblem(r?.error === "admin" ? t("adminBadCode") : t("adminFail")); return; }
    setNote(`${t("adminDeleted")} ${r.removed ?? 0} ${t("adminScans")}`);
    await load();
    if (run && openId === p.id) { const rr = await api.adminRuns(p.id).catch(() => null); setRuns(rr?.runs ?? null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <div ref={box} className="enter flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-warning/15 text-warning"><ShieldAlert className="size-5" /></div>
            <h2 id="admin-title" className="text-base font-semibold">{t("adminTitle")}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {unlocked && (
              <>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy} aria-label={t("retry")}><RefreshCw /></Button>
                <Button variant="ghost" size="sm" onClick={() => { void api.adminLock(); onLocked(); onClose(); }}><Lock /> {t("adminLock")}</Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("closeLabel")}><X /></Button>
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          {!unlocked ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="admin-code">{t("adminCode")}</label>
              <input
                id="admin-code"
                ref={input}
                type="password"
                value={code}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
                className="num h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("adminHint")}</p>
              <div className="mt-4 flex justify-end">
                <Button onClick={unlock} disabled={busy || !code.trim()}>{busy && <LoaderCircle className="animate-spin" />} {t("adminUnlock")}</Button>
              </div>
            </div>
          ) : players === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground" aria-busy="true">{t("loading")}</p>
          ) : players.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("adminEmpty")}</p>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("adminNote")}</p>
              <ul className="flex flex-col gap-3">
                {players.map((p) => (
                  <li key={p.id} className="rounded-xl border border-border bg-background/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium">{p.name}</span>
                        <span className="num ms-2 text-xs text-muted-foreground">{p.id}</span>
                        <span className="num ms-2 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{p.total} {t("adminScans")}</span>
                      </div>
                      <Button
                        variant={confirm === p.id + "|*" ? "destructive" : "ghost"}
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(p, "")}
                      >
                        <Trash2 /> {confirm === p.id + "|*" ? t("adminConfirm") : t("adminDeleteAll")}
                      </Button>
                    </div>
                    {p.reset && <p className="mt-2 text-xs text-warning">{t("adminResetPending")}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button variant={confirm === p.id + "|reset" ? "destructive" : "ghost"} size="sm" onClick={() => void resetPassword(p)} disabled={busy}>
                        <KeyRound /> {confirm === p.id + "|reset" ? t("adminConfirm") : t("adminReset")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void showRuns(p)} disabled={busy}>
                        {openId === p.id ? <ChevronUp /> : <ChevronDown />} {openId === p.id ? t("adminHideRuns") : t("adminShowRuns")}
                      </Button>
                    </div>
                    {openId === p.id && (
                      <div className="mt-2 overflow-hidden rounded-lg border border-border">
                        {runs === null ? (
                          <p className="p-3 text-xs text-muted-foreground" aria-busy="true">{t("loading")}</p>
                        ) : runs.length === 0 ? (
                          <p className="p-3 text-xs text-muted-foreground">{t("adminEmpty")}</p>
                        ) : runs.map((r, i) => {
                          const key = p.id + "|run:" + r.game + ":" + r.id;
                          return (
                            <div key={r.game + r.id} className={cn("flex items-center justify-between gap-3 p-2.5 text-xs", i > 0 && "border-t border-border")}>
                              <div className="min-w-0">
                                <div className="num font-medium">{r.time || "—"} <span className="ms-1 font-normal text-muted-foreground">{r.game}</span></div>
                                <div className="num truncate text-muted-foreground">
                                  {r.best ? `${r.best.ip} · ${[r.best.country, r.best.city].filter((x) => x && x !== "?").join(" · ")} · ${r.best.avg != null ? r.best.avg + " ms" : "—"}` : "—"}
                                </div>
                              </div>
                              <Button variant={confirm === key ? "destructive" : "ghost"} size="sm" disabled={busy} onClick={() => void remove(p, r.game, r.id)} aria-label={t("adminDeleteOne")}>
                                <Trash2 /> {confirm === key ? t("adminConfirm") : ""}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {p.games.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {p.games.map((g) => {
                          const key = p.id + "|" + g.game;
                          return (
                            <li key={g.game}>
                              <button
                                disabled={busy}
                                onClick={() => void remove(p, g.game)}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-default disabled:opacity-60",
                                  confirm === key ? "border-destructive/50 bg-destructive/15 text-destructive" : "border-border text-muted-foreground hover:bg-accent",
                                )}
                                title={g.last}
                              >
                                <Trash2 className="size-3.5" />
                                {confirm === key ? t("adminConfirm") : g.game}
                                <span className="num rounded-full bg-muted px-1.5 text-[11px]">{g.count}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {note && <p role="status" className="mt-4 text-xs text-success">{note}</p>}
          {problem && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{problem}</p>}
        </div>
      </div>
    </div>
  );
}
