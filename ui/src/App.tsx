import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Ban, Download, FolderOpen, Gamepad2, History as HistoryIcon, Languages, Play, Radar, RefreshCw, ShieldCheck, Square, Wifi, X } from "lucide-react";
import { api, type BlockEntry, type Info, type ServerResult, type State, type UpdateInfo } from "@/api";
import { makeT, type Lang, type Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { covers } from "@/lib/cidr";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { VerticalStepper } from "@/components/ui/stepper";
import { ResultCard, locationOf } from "@/components/ResultCard";
import { HistoryView } from "@/views/History";
import { BlockedView } from "@/views/Blocked";

const EMPTY: State = {
  phase: "idle", game: "", secondsLeft: 0, totalSeconds: 0, ports: 0,
  error: "", errorCode: "", results: [], csvPath: "",
};

type Tab = "scan" | "history" | "blocked";

function loadLang(): Lang {
  try {
    const v = localStorage.getItem("lang");
    if (v === "ar" || v === "en") return v;
  } catch { /* storage unavailable */ }
  return "ar";
}

export default function App() {
  const [lang, setLang] = useState<Lang>(loadLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [tab, setTab] = useState<Tab>("scan");
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<State>(EMPTY);
  const [game, setGame] = useState("");
  const [busy, setBusy] = useState(false);
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [updPhase, setUpdPhase] = useState<"idle" | "checking" | "updating">("idle");
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  const [fwError, setFwError] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const historyCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const isBlocked = useCallback((ip: string) => blocks.some((b) => covers(b.ip, ip)), [blocks]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  }, [lang]);

  const refreshBlocks = useCallback(async () => {
    setBlocks(await api.blocks().catch(() => [] as BlockEntry[]));
  }, []);

  const refreshHistoryCount = useCallback(async () => {
    setCounts(await api.historyCounts().catch(() => ({} as Record<string, number>)));
  }, []);

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i);
      setGame((g) => g || i.games.find((x) => x.enabled)?.name || "");
    }).catch(() => {});
    void refreshBlocks();
    void refreshHistoryCount();
    const poll = setInterval(() => api.state().then(setState).catch(() => {}), 1000);
    const beat = setInterval(() => api.heartbeat().catch(() => {}), 3000);
    api.heartbeat().catch(() => {});
    return () => { clearInterval(poll); clearInterval(beat); };
  }, [refreshBlocks, refreshHistoryCount]);

  // a finished scan adds a history entry
  useEffect(() => { if (state.phase === "done") void refreshHistoryCount(); }, [state.phase, refreshHistoryCount]);

  const checkUpdate = useCallback(async () => {
    setUpdPhase("checking");
    try { setUpd(await api.checkUpdate()); }
    catch { setUpd({ current: "", latest: "", hasUpdate: false, notes: "", error: "x" }); }
    setUpdPhase("idle");
  }, []);

  useEffect(() => { void checkUpdate(); }, [checkUpdate]);

  const applyUpdate = async () => {
    setUpdPhase("updating");
    const r = await api.applyUpdate().catch(() => ({ ok: false }));
    if (!r.ok) { setUpdPhase("idle"); setUpd((u) => (u ? { ...u, error: "x" } : u)); return; }
    // the app restarts itself in a new window; close this old one
    setTimeout(() => window.close(), 1500);
  };

  const fwMessage = (code?: string, detail?: string) =>
    (code === "uac" ? t("errBlockUac") : t("errBlockFw")) + (detail ? "\n" + detail : "");

  // target = a single IP or a range such as 34.165.0.0/16
  const block = useCallback(async (s: ServerResult, gameName: string, target: string) => {
    setFwError("");
    const r = await api.block(target, locationOf(s), gameName).catch(() => ({ ok: false, error: "x" }));
    if (!r.ok) setFwError(fwMessage(r.error, (r as { detail?: string }).detail));
    await refreshBlocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBlocks, lang]);

  const unblockTarget = useCallback(async (target: string) => {
    setFwError("");
    const r = await api.unblock(target).catch(() => ({ ok: false, error: "x" }));
    if (!r.ok) setFwError(fwMessage(r.error, (r as { detail?: string }).detail));
    await refreshBlocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBlocks, lang]);

  // a card is unblocked by removing whichever rule (IP or range) covers it
  const unblockFor = useCallback(async (ip: string) => {
    const e = blocks.find((b) => covers(b.ip, ip));
    if (e) await unblockTarget(e.ip);
  }, [blocks, unblockTarget]);

  // one admin prompt removes every rule the app made
  const unblockAll = useCallback(async () => {
    setFwError("");
    const r = await api.unblockAll().catch(() => ({ ok: false, error: "x" } as { ok: boolean; error?: string; detail?: string }));
    if (!r.ok) setFwError(fwMessage(r.error, r.detail));
    await refreshBlocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBlocks, lang]);

  const addManual = useCallback(async (target: string) => {
    setFwError("");
    const r = await api.block(target, "", "").catch(() => ({ ok: false, error: "x" } as { ok: boolean; error?: string; detail?: string }));
    if (!r.ok) setFwError(fwMessage(r.error, r.detail));
    await refreshBlocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBlocks, lang]);

  const syncBlocks = useCallback(async () => {
    setBlocks(await api.blocksSync().catch(() => [] as BlockEntry[]));
  }, []);

  const p = state.phase;
  const running = p !== "idle" && p !== "done" && p !== "error";

  const start = async () => {
    if (!game) return;
    setBusy(true);
    await api.start(game).catch(() => {});
    setBusy(false);
  };

  const stepCurrent =
    p === "idle" || p === "error" ? 1
    : p === "elevating" || p === "waiting_game" ? 2
    : p === "ready" ? 3
    : p === "capturing" ? 4
    : 5;

  const steps = [
    { title: t("chooseGame"), hint: t("chooseGameHint") },
    { title: t("launchGame"), hint: p === "elevating" ? t("needAdmin") : t("launchGameHint") },
    { title: t("joinMatch"), hint: t("joinMatchHint") },
    { title: t("capture"), hint: t("captureHint") },
    { title: t("analyze"), hint: t("analyzeHint") },
  ];

  const errText =
    state.errorCode === "cancelled" ? t("errCancelled")
    : state.errorCode === "uac" ? t("errUac")
    : state.errorCode === "nodata" ? t("errNoData")
    : state.errorCode === "capture" ? t("errCapture")
    : t("errGeneric");

  const best = state.results[0];

  const tabs: { id: Tab; label: string; icon: typeof Radar; count?: number }[] = [
    { id: "scan", label: t("tabScan"), icon: Radar },
    { id: "history", label: t("tabHistory"), icon: HistoryIcon, count: historyCount },
    { id: "blocked", label: t("tabBlocked"), icon: Ban, count: blocks.length },
  ];

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-5">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Wifi className="size-5" />
          </div>
          <div>
            <h1 className="text-lg leading-tight font-semibold">GameNetKit</h1>
            <p className="text-xs text-muted-foreground">
              {t("tagline")}
              {info && <> · {t("version")} <span className="num">{info.version}</span></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {updPhase === "checking" && <Status variant="info" pulse>{t("checking")}</Status>}
          {updPhase === "idle" && upd && !upd.error && !upd.hasUpdate && <Status variant="success">{t("upToDate")}</Status>}
          {updPhase === "idle" && upd?.hasUpdate && <Status variant="warning" pulse>{t("updateAvail")} <span className="num">{upd.latest}</span></Status>}
          {updPhase === "idle" && upd?.error && <Status variant="error">{t("updateFail")}</Status>}
          <Button variant="outline" size="sm" onClick={checkUpdate} disabled={updPhase !== "idle"}>
            <RefreshCw className={cn(updPhase === "checking" && "animate-spin")} />
            {t("checkUpdate")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Languages />
            {t("lang")}
          </Button>
        </div>
      </header>

      {upd?.hasUpdate && (
        <div className="enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {t("updateAvail")}: <span className="num">{upd.current} → {upd.latest}</span>
            </div>
            {upd.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">{upd.notes}</p>}
          </div>
          <Button onClick={applyUpdate} disabled={updPhase === "updating"}>
            <Download />
            {updPhase === "updating" ? t("updating") : t("updateNow")}
          </Button>
        </div>
      )}

      {/* tabs */}
      <nav className="flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
        {tabs.map((x) => {
          const Icon = x.icon;
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(x.id)}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} />
              {x.label}
              {x.count != null && x.count > 0 && (
                <span className={cn("num rounded-full px-1.5 text-[11px]", x.id === "blocked" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{x.count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {fwError && (
        <div className="enter flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="num whitespace-pre-line break-all" dir="auto">{fwError}</span>
          <button className="cursor-pointer opacity-70 hover:opacity-100" onClick={() => setFwError("")} aria-label="close"><X className="size-4" /></button>
        </div>
      )}

      {tab === "history" && (
        <HistoryView
          t={t}
          games={info?.games.map((g) => g.name) ?? []}
          counts={counts}
          isBlocked={isBlocked}
          onBlock={block}
          onUnblock={unblockFor}
          onChanged={refreshHistoryCount}
        />
      )}

      {tab === "blocked" && <BlockedView t={t} blocks={blocks} onUnblock={unblockTarget} onUnblockAll={unblockAll} onAdd={addManual} onSync={syncBlocks} />}

      {tab === "scan" && (
        <main className="grid flex-1 gap-5 lg:grid-cols-[330px_1fr]">
          {/* control + stepper */}
          <section className="flex flex-col gap-5 self-start rounded-xl border border-border bg-card p-5">
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">{t("chooseGame")}</div>
              <div className="grid gap-2">
                {info?.games.filter((g) => g.enabled).map((g) => (
                  <button
                    key={g.name}
                    disabled={running}
                    onClick={() => setGame(g.name)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-start transition-colors disabled:cursor-default disabled:opacity-60",
                      game === g.name ? "border-primary/60 bg-primary/10" : "border-border hover:bg-accent",
                    )}
                  >
                    <Gamepad2 className={cn("size-4", game === g.name ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-medium">{g.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {!running && (
                <Button size="lg" onClick={start} disabled={!game || busy}>
                  <Play /> {p === "done" || p === "error" ? t("again") : t("start")}
                </Button>
              )}
              {p === "ready" && (
                <Button size="lg" onClick={() => api.begin()}>
                  <Activity /> {t("begin")}
                </Button>
              )}
              {running && (
                <Button variant="destructive" onClick={() => api.cancel()}>
                  <Square /> {t("cancel")}
                </Button>
              )}
            </div>

            {p === "capturing" && (
              <div className="rounded-lg bg-muted p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("gameDetected")} · <span className="num">{state.ports}</span> {t("portsSeen")}</span>
                  <span className="num text-foreground">{state.secondsLeft} {t("secondsLeft")}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-1000"
                    style={{ width: `${state.totalSeconds ? 100 - (100 * state.secondsLeft) / state.totalSeconds : 0}%` }}
                  />
                </div>
              </div>
            )}

            <VerticalStepper steps={steps} current={stepCurrent} loading={running && p !== "ready"} done={p === "done"} />
          </section>

          {/* results */}
          <section className="flex flex-col gap-4">
            {p === "error" && (
              <div className="enter rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                <div className="text-sm font-medium text-destructive">{t("errorTitle")}</div>
                <p className="mt-1 text-sm text-foreground/90">{errText}</p>
                {state.error && <p className="num mt-1 text-xs text-muted-foreground" dir="ltr">{state.error}</p>}
              </div>
            )}

            {p === "done" && best && (
              <>
                <div className="enter flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">{t("resultsTitle")} · {state.game}</h2>
                  <Button variant="secondary" size="sm" onClick={() => api.openFolder(state.game)}>
                    <FolderOpen /> {t("openFolder")}
                  </Button>
                </div>
                <VerdictBanner best={best} t={t} />
                <div className="grid gap-4 md:grid-cols-2">
                  {state.results.map((s, i) => (
                    <ResultCard
                      key={s.ip}
                      s={s}
                      t={t}
                      first={i === 0}
                      delay={i * 60}
                      blocked={isBlocked(s.ip)}
                      onBlock={(target) => block(s, state.game, target)}
                      onUnblock={() => unblockFor(s.ip)}
                    />
                  ))}
                </div>
              </>
            )}

            {(p === "idle" || running) && (
              <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
                  <Activity className="size-6" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t("emptyTitle")}</div>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("emptyText")}</p>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-primary" /> {t("howTitle")}
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>• {t("how1")}</li>
                <li>• {t("how2")}</li>
                <li>• {t("how3")}</li>
              </ul>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function verdictKey(v: ServerResult["verdict"]): Key {
  return v === "good" ? "verdictGood" : v === "ok" ? "verdictOk" : v === "bad" ? "verdictBad" : "verdictNoReply";
}

function VerdictBanner({ best, t }: { best: ServerResult; t: (k: Key) => string }) {
  const box =
    best.verdict === "good" ? "border-success/30 bg-success/10"
    : best.verdict === "bad" ? "border-destructive/30 bg-destructive/10"
    : best.verdict === "ok" ? "border-warning/30 bg-warning/10"
    : "border-border bg-card";
  return (
    <div className={cn("enter rounded-xl border p-4", box)}>
      <div className="text-sm font-medium">{t(verdictKey(best.verdict))}</div>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="num">{best.ip}</span> · {best.country}{best.city && best.city !== "?" ? `, ${best.city}` : ""}
        {best.avg != null && <> · <span className="num">{best.avg} ms</span></>}
      </p>
    </div>
  );
}
