import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, Gamepad2, History as HistoryIcon, Trash2 } from "lucide-react";
import { api, type Run, type RunSummary, type ServerResult } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Flag } from "@/lib/flags";
import { rangeStats, suggestions } from "@/lib/stats";
import { Button } from "@/components/ui/button";
import { Status, type StatusVariant } from "@/components/ui/status";
import { RowSkeleton, ServerCardSkeleton } from "@/components/ui/skeleton";
import { ResultCard, locationOf, verdictLabel } from "@/components/ResultCard";
import { StatsCard } from "@/components/StatsCard";
import { Suggestions } from "@/components/Suggestions";

type T = (k: Key) => string;
type Sort = "new" | "old" | "pingLow" | "pingHigh";

const verdictVariant: Record<ServerResult["verdict"], StatusVariant> = {
  good: "success", ok: "warning", bad: "error", noreply: "default",
};

const selectCls =
  "h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

interface Props {
  t: T;
  /** every game the app knows; each one has its own history, stored in its own folder */
  games: string[];
  counts: Record<string, number>;
  isBlocked: (ip: string) => boolean;
  onBlock: (s: ServerResult, game: string, target: string, whilePlaying: boolean) => Promise<void>;
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
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<Sort>("new");

  const load = useCallback(async () => {
    if (!sel) return;
    const r = await api.history(sel).catch(() => [] as RunSummary[]);
    setRows(r);
    onChanged();
  }, [sel, onChanged]);

  useEffect(() => {
    setRows(null); setOpen(""); setRun(null); setConfirmId(""); setConfirmAll(false); setExported(""); setCountry("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!confirmId && !confirmAll) return;
    const id = setTimeout(() => { setConfirmId(""); setConfirmAll(false); }, 4000);
    return () => clearTimeout(id);
  }, [confirmId, confirmAll]);

  const countries = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.best?.country).filter((c): c is string => !!c && c !== "?"))].sort(),
    [rows],
  );

  // rows arrive newest first; filter and sort only change what is listed, the statistics always use every scan
  const shown = useMemo(() => {
    let list = (rows ?? []).filter((r) => !country || r.best?.country === country);
    const ping = (r: RunSummary) => r.best?.avg ?? Number.MAX_SAFE_INTEGER;
    if (sort === "old") list = [...list].reverse();
    if (sort === "pingLow") list = [...list].sort((a, b) => ping(a) - ping(b));
    if (sort === "pingHigh") list = [...list].sort((a, b) => (b.best?.avg ?? -1) - (a.best?.avg ?? -1));
    return list;
  }, [rows, country, sort]);

  const tips = useMemo(() => (rows ? suggestions(rangeStats(rows), isBlocked) : []), [rows, isBlocked]);

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
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy="true">
            <RowSkeleton /><div className="border-t border-border" /><RowSkeleton /><div className="border-t border-border" /><RowSkeleton />
          </div>
        </>
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
          <Suggestions t={t} items={tips} onBlock={(s, target) => onBlock(s, sel, target, true)} />
          <StatsCard rows={rows} t={t} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t("historyOf")} {sel} <span className="num text-sm font-normal text-muted-foreground">({shown.length}{shown.length !== rows.length ? `/${rows.length}` : ""})</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              <select className={selectCls} value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t("filterAll")}>
                <option value="">{t("filterAll")}</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="new">{t("sortNew")}</option>
                <option value="old">{t("sortOld")}</option>
                <option value="pingLow">{t("sortPingLow")}</option>
                <option value="pingHigh">{t("sortPingHigh")}</option>
              </select>
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
            {shown.map((r, i) => {
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
                          <div className="flex items-center gap-1.5 text-xs break-words text-muted-foreground">
                            <Flag country={b.country} cc={b.cc} />
                            <span>{locationOf(b)}</span>
                          </div>
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
                        <><ServerCardSkeleton /><ServerCardSkeleton /></>
                      ) : (
                        run.results.map((s, k) => (
                          <ResultCard
                            key={s.ip}
                            s={s}
                            t={t}
                            first={k === 0}
                            blocked={isBlocked(s.ip)}
                            game={run.game}
                            onBlock={(target, wp) => onBlock(s, run.game, target, wp)}
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
