import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, Gamepad2, History as HistoryIcon, Trash2 } from "lucide-react";
import { api, type Run, type RunSummary, type ServerResult } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Status, type StatusVariant } from "@/components/ui/status";
import { ResultCard, locationOf, verdictLabel } from "@/components/ResultCard";

type T = (k: Key) => string;

const verdictVariant: Record<ServerResult["verdict"], StatusVariant> = {
  good: "success", ok: "warning", bad: "error", noreply: "default",
};

interface Props {
  t: T;
  /** every game the app knows; each one has its own history, stored in its own folder */
  games: string[];
  counts: Record<string, number>;
  isBlocked: (ip: string) => boolean;
  onBlock: (s: ServerResult, game: string, target: string) => Promise<void>;
  onUnblock: (ip: string) => Promise<void>;
  onChanged: () => void;
}

export function HistoryView({ t, games, counts, isBlocked, onBlock, onUnblock, onChanged }: Props) {
  const [sel, setSel] = useState<string>(() => games.find((g) => (counts[g] ?? 0) > 0) ?? games[0] ?? "");
  const [rows, setRows] = useState<RunSummary[] | null>(null);
  const [open, setOpen] = useState<string>("");
  const [run, setRun] = useState<Run | null>(null);
  const [confirmId, setConfirmId] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [exported, setExported] = useState("");

  const load = useCallback(async () => {
    if (!sel) return;
    const r = await api.history(sel).catch(() => [] as RunSummary[]);
    setRows(r);
    onChanged();
  }, [sel, onChanged]);

  useEffect(() => {
    setRows(null); setOpen(""); setRun(null); setConfirmId(""); setConfirmAll(false); setExported("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!confirmId && !confirmAll) return;
    const id = setTimeout(() => { setConfirmId(""); setConfirmAll(false); }, 4000);
    return () => clearTimeout(id);
  }, [confirmId, confirmAll]);

  const toggle = async (id: string) => {
    if (open === id) { setOpen(""); setRun(null); return; }
    setOpen(id);
    setRun(null);
    setRun(await api.historyGet(sel, id).catch(() => null));
  };

  const del = async (id: string) => {
    if (confirmId !== id) { setConfirmId(id); return; }
    await api.historyDelete(sel, id).catch(() => {});
    setConfirmId("");
    if (open === id) { setOpen(""); setRun(null); }
    await load();
  };

  const clear = async () => {
    if (!confirmAll) { setConfirmAll(true); return; }
    await api.historyClear(sel).catch(() => {});
    setConfirmAll(false); setOpen(""); setRun(null);
    await load();
  };

  const exportAll = async () => {
    const r = await api.historyExport(sel).catch(() => null);
    if (r?.ok) { setExported(r.path); setTimeout(() => setExported(""), 8000); }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* one chip per game: switching games never mixes their scans */}
      <div className="flex flex-wrap gap-2">
        {games.map((g) => (
          <button
            key={g}
            onClick={() => setSel(g)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              sel === g ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            <Gamepad2 className={cn("size-4", sel === g && "text-primary")} />
            {g}
            <span className="num rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{counts[g] ?? 0}</span>
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><HistoryIcon className="size-6" /></div>
          <div>
            <div className="text-sm font-medium">{t("historyEmpty")} · {sel}</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("historyEmptyText")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t("historyOf")} {sel} <span className="num text-sm font-normal text-muted-foreground">({rows.length})</span></h2>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={exportAll}>
                <Download /> {t("exportHistory")}
              </Button>
              <Button variant={confirmAll ? "destructive" : "ghost"} size="sm" onClick={clear}>
                <Trash2 /> {confirmAll ? t("confirmClear") : t("clearAll")}
              </Button>
            </div>
          </div>
          {exported && (
            <div className="enter rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
              <div className="font-medium text-success">{t("exported")}</div>
              <div className="num mt-0.5 break-all text-muted-foreground" dir="ltr">{exported}</div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {rows.map((r, i) => {
              const b = r.best;
              const isOpen = open === r.id;
              return (
                <div key={r.id} className={cn(i > 0 && "border-t border-border")}>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3 p-4 sm:grid-cols-[150px_1fr_90px_110px_auto]">
                    <div className="min-w-0">
                      <div className="num text-sm font-medium">{r.time}</div>
                      <div className="text-xs text-muted-foreground">{r.game}</div>
                    </div>
                    <div className="col-span-2 min-w-0 sm:order-none sm:col-span-1">
                      {b ? (
                        <>
                          <div className="num text-sm">{b.ip}</div>
                          <div className="text-xs break-words text-muted-foreground">{locationOf(b)}</div>
                        </>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <div className="num text-sm sm:text-center">{b?.avg != null ? `${b.avg} ms` : "—"}</div>
                    <div className="sm:justify-self-center">
                      {b && <Status variant={verdictVariant[b.verdict]}>{verdictLabel(b.verdict, t)}</Status>}
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => toggle(r.id)}>
                        {isOpen ? <ChevronUp /> : <ChevronDown />} {isOpen ? t("hide") : t("view")}
                      </Button>
                      <Button variant={confirmId === r.id ? "destructive" : "ghost"} size="sm" onClick={() => del(r.id)} aria-label={t("deleteRun")}>
                        <Trash2 /> {confirmId === r.id ? t("confirmDelete") : ""}
                      </Button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="grid gap-4 border-t border-border bg-background/40 p-4 md:grid-cols-2">
                      {run === null ? (
                        <p className="text-sm text-muted-foreground">{t("loading")}</p>
                      ) : (
                        run.results.map((s, k) => (
                          <ResultCard
                            key={s.ip}
                            s={s}
                            t={t}
                            first={k === 0}
                            blocked={isBlocked(s.ip)}
                            onBlock={(target) => onBlock(s, run.game, target)}
                            onUnblock={() => onUnblock(s.ip)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
