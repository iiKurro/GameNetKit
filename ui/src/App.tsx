import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Download, FolderOpen, Gamepad2, Languages, Play, RefreshCw, ShieldCheck, Square, Wifi } from "lucide-react";
import { api, type Info, type ServerResult, type State, type UpdateInfo } from "@/api";
import { makeT, type Lang, type Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { VerticalStepper } from "@/components/ui/stepper";
import {
  ServerCard,
  ServerCardHeader,
  ServerCardMeter,
  ServerCardSpec,
  ServerCardSpecs,
  ServerCardStatus,
  ServerCardTitle,
} from "@/components/ui/server-card";

const EMPTY: State = {
  phase: "idle", game: "", secondsLeft: 0, totalSeconds: 0, ports: 0,
  error: "", errorCode: "", results: [], csvPath: "",
};

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
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<State>(EMPTY);
  const [game, setGame] = useState("");
  const [busy, setBusy] = useState(false);
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [updPhase, setUpdPhase] = useState<"idle" | "checking" | "updating">("idle");

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  }, [lang]);

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i);
      setGame((g) => g || i.games.find((x) => x.enabled)?.name || "");
    }).catch(() => {});
    const poll = setInterval(() => api.state().then(setState).catch(() => {}), 1000);
    const beat = setInterval(() => api.heartbeat().catch(() => {}), 3000);
    api.heartbeat().catch(() => {});
    return () => { clearInterval(poll); clearInterval(beat); };
  }, []);

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
    if (!r.ok) { setUpdPhase("idle"); setUpd((u) => (u ? { ...u, error: "x" } : u)); }
  };

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
        <div className="flex items-center gap-2">
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

      <main className="grid flex-1 gap-5 lg:grid-cols-[330px_1fr]">
        {/* left: control + stepper */}
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

        {/* right: results */}
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
                <Button variant="secondary" size="sm" onClick={() => api.openFolder()}>
                  <FolderOpen /> {t("openFolder")}
                </Button>
              </div>
              <VerdictBanner best={best} t={t} />
              <div className="grid gap-4 md:grid-cols-2">
                {state.results.map((s, i) => (
                  <ResultCard key={s.ip} s={s} first={i === 0} t={t} delay={i * 60} />
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
    </div>
  );
}

function verdictKey(v: ServerResult["verdict"]): Key {
  return v === "good" ? "verdictGood" : v === "ok" ? "verdictOk" : v === "bad" ? "verdictBad" : "verdictNoReply";
}

function VerdictBanner({ best, t }: { best: ServerResult; t: (k: Key) => string }) {
  const variant = best.verdict === "good" ? "success" : best.verdict === "bad" ? "error" : best.verdict === "ok" ? "warning" : "default";
  const box =
    variant === "success" ? "border-success/30 bg-success/10"
    : variant === "error" ? "border-destructive/30 bg-destructive/10"
    : variant === "warning" ? "border-warning/30 bg-warning/10"
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

function ResultCard({ s, first, t, delay }: { s: ServerResult; first: boolean; t: (k: Key) => string; delay: number }) {
  const label = s.verdict === "good" ? t("good") : s.verdict === "ok" ? t("ok") : s.verdict === "bad" ? t("bad") : t("noReply");
  const region = [s.country, s.city && s.city !== "?" ? s.city : "", s.provider && s.provider !== "?" ? s.provider : ""].filter(Boolean).join(" · ");
  return (
    <ServerCard highlight={first} className="enter" style={{ animationDelay: `${delay}ms` }}>
      <ServerCardHeader>
        <ServerCardTitle region={region}>{s.ip}</ServerCardTitle>
        <ServerCardStatus status={s.verdict}>{label}</ServerCardStatus>
      </ServerCardHeader>
      {first && <Status variant="success" className="self-start">{t("matchServer")}</Status>}
      <ServerCardSpecs>
        <ServerCardSpec label={t("packets")}>{s.packets}</ServerCardSpec>
        <ServerCardSpec label={t("port")}>{s.port}</ServerCardSpec>
        <ServerCardSpec label="KB">{s.kb}</ServerCardSpec>
      </ServerCardSpecs>
      {s.avg == null ? (
        <p className="text-xs text-muted-foreground">{t("noReply")}</p>
      ) : (
        <div className="grid gap-3">
          <ServerCardMeter label={t("ping")} value={s.avg} display={`${s.avg} ms`} max={200} thresholds={[60, 100]} />
          <ServerCardMeter label={t("jitter")} value={s.jitter ?? 0} display={`${s.jitter ?? 0} ms`} max={40} thresholds={[8, 15]} />
          <ServerCardMeter label={t("loss")} value={s.loss} display={`${s.loss}%`} max={10} thresholds={[1, 3]} />
        </div>
      )}
    </ServerCard>
  );
}
