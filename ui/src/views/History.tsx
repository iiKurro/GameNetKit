import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History as HistoryIcon, Trash2 } from "lucide-react";
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
  blockedIps: Set<string>;
  onBlock: (s: ServerResult, game: string) => Promise<void>;
  onUnblock: (ip: string) => Promise<void>;
  onChanged: (count: number) => void;
}

export function HistoryView({ t, blockedIps, onBlock, onUnblock, onChanged }: Props) {
  const [rows, setRows] = useState<RunSummary[] | null>(null);
  const [open, setOpen] = useState<string>("");
  const [run, setRun] = useState<Run | null>(null);
  const [confirmId, setConfirmId] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const r = await api.history().catch(() => [] as RunSummary[]);
    setRows(r);
    onChanged(r.length);
  }, [onChanged]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!confirmId && !confirmAll) return;
    const id = setTimeout(() => { setConfirmId(""); setConfirmAll(false); }, 4000);
    return () => clearTimeout(id);
  }, [confirmId, confirmAll]);

  const toggle = async (id: string) => {
    if (open === id) { setOpen(""); setRun(null); return; }
    setOpen(id);
    setRun(null);
    setRun(await api.historyGet(id).catch(() => null));
  };

  const del = async (id: string) => {
    if (confirmId !== id) { setConfirmId(id); return; }
    await api.historyDelete(id).catch(() => {});
    setConfirmId("");
    if (open === id) { setOpen(""); setRun(null); }
    await load();
  };

  const clear = async () => {
    if (!confirmAll) { setConfirmAll(true); return; }
    await api.historyClear().catch(() => {});
    setConfirmAll(false); setOpen(""); setRun(null);
    await load();
  };

  if (rows === null) return <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>;

  if (rows.length === 0) {
    return (
      <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><HistoryIcon className="size-6" /></div>
        <div>
          <div className="text-sm font-medium">{t("historyEmpty")}</div>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("historyEmptyText")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("historyTitle")} <span className="num text-sm font-normal text-muted-foreground">({rows.length})</span></h2>
        <Button variant={confirmAll ? "destructive" : "ghost"} size="sm" onClick={clear}>
          <Trash2 /> {confirmAll ? t("confirmClear") : t("clearAll")}
        </Button>
      </div>

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
                        blocked={blockedIps.has(s.ip)}
                        onBlock={(x) => onBlock(x, run.game)}
                        onUnblock={onUnblock}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
