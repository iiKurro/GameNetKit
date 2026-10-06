import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Ban, Download, FolderOpen, Gamepad2, History as HistoryIcon, Languages, Lightbulb, Play, Radar, RefreshCw, ShieldCheck, Square, UserRound, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ProfileDialog } from "@/components/ProfileDialog";
import { AdminPanel } from "@/components/AdminPanel";
import { motion } from "motion/react";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { SettingsPopover } from "@/components/SettingsPopover";
import { api, type BlockEntry, type GuardState, type Info, type Person, type Profile, type RunSummary, type Settings, type SyncState, type ServerResult, type State, type UpdateInfo } from "@/api";
import { makeT, type Lang, type Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { covers } from "@/lib/cidr";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { VerticalStepper } from "@/components/ui/stepper";
import { ResultCard, locationOf } from "@/components/ResultCard";
import { Suggestions } from "@/components/Suggestions";
import { InsightsView } from "@/views/Insights";
import { buildInsight, rangeBlocked, type Source } from "@/lib/insights";
import { Skeleton, ServerCardSkeleton } from "@/components/ui/skeleton";
import { rangeStats, suggestions } from "@/lib/stats";
import { HistoryView } from "@/views/History";
import { BlockedView } from "@/views/Blocked";

const EMPTY: State = {
  phase: "idle", game: "", secondsLeft: 0, totalSeconds: 0, ports: 0,
  error: "", errorCode: "", results: [], csvPath: "",
};

type Tab = "scan" | "history" | "insights" | "blocked";

function loadLang(): Lang {
  try {
    const v = localStorage.getItem("lang");
    if (v === "ar" || v === "en") return v;
  } catch { /* storage unavailable */ }
  return "ar";
}

/** keeps the previous object when a poll brings nothing new, so nothing downstream reloads for no reason */
function sameOr<T>(prev: T, next: T): T {
  try { return JSON.stringify(prev) === JSON.stringify(next) ? prev : next; } catch { return next; }
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
  const [scanRows, setScanRows] = useState<RunSummary[]>([]);
  const [guard, setGuard] = useState<GuardState>({ running: false, games: [], applied: [] });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [dialog, setDialog] = useState<null | "name" | "code">(null);
  // first run: asked for the name (and the group code) once; stays open until everything was accepted
  const [firstRun, setFirstRun] = useState(false);
  const firstRunSeen = useRef(false);
  // the hidden group-admin panel (Ctrl+Shift+A)
  const [adminOpen, setAdminOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); setAdminOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [lost, setLost] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingBusy, setSettingBusy] = useState("");

  // a failed poll keeps what was shown before (a dropped request must not make friends or the sync status vanish)
  const refreshPeople = useCallback(async () => {
    const r = await api.people().catch(() => null);
    if (r) setPeople((prev) => sameOr(prev, r));
  }, []);

  const refreshSync = useCallback(async () => {
    const r = await api.syncState().catch(() => null);
    if (r) setSync((prev) => sameOr(prev, r));
  }, []);

  const refreshBlocks = useCallback(async () => {
    const r = await api.blocks().catch(() => null);
    if (r) setBlocks((prev) => sameOr(prev, r));
  }, []);

  const refreshHistoryCount = useCallback(async () => {
    const r = await api.historyCounts().catch(() => null);
    if (r) setCounts((prev) => sameOr(prev, r));
  }, []);

  // remembered choices (guard on/off, background, start with Windows)
  const refreshSettings = useCallback(async () => {
    const r = await api.settings().catch(() => null);
    if (r) setSettings(r);
  }, []);

  // name and (optionally) the group code from the dialog. Returns a message when something must be fixed, "" when done.
  const saveProfile = useCallback(async (name: string, code: string): Promise<string> => {
    if (name && name !== profile?.name) {
      const r = await api.profileSet(name).catch(() => null);
      if (!r || !r.name) return t("errSaveName");
      setProfile(r);
    }
    if (code) {
      const s = await api.syncConfig({ code }).catch(() => null);
      if (!s || s.ok === false) return t("errSaveCode");
      setSync(s);
      // the server decides if the code is right: wait for the first answer so a wrong code is told right here
      await api.syncNow().catch(() => null);
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await api.syncState().catch(() => null);
        if (!st) break;
        setSync(st);
        if (st.error === "code") return t("syncErrCode");
        if (!st.busy && (st.lastOkSecondsAgo >= 0 || st.error)) break;
      }
    }
    setDialog(null);
    setFirstRun(false);
    return "";
  }, [profile?.name, t]);

  const toggleSync = useCallback(async (enabled: boolean) => {
    const s = await api.syncConfig({ enabled }).catch(() => null);
    if (s) setSync(s);
  }, []);
  const historyCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const isBlocked = useCallback((ip: string) => blocks.some((b) => covers(b.ip, ip)), [blocks]);
  const blockedRules = useMemo(() => blocks.map((b) => b.ip), [blocks]);
  const isRangeBlocked = useCallback((range: string) => rangeBlocked(range, blockedRules), [blockedRules]);

  // Everybody's scans, per game (mine + the group's friends). Each person's list is fetched again only when that person's
  // number of scans for the game changed, and a failed fetch keeps the last good list and is retried a few seconds later.
  const [sources, setSources] = useState<Record<string, Source[]> | null>(null);
  const [sourcesFail, setSourcesFail] = useState(false);
  const [sourcesTick, setSourcesTick] = useState(0);
  const rowCache = useRef(new Map<string, { sig: string; rows: RunSummary[] }>());
  const gameNames = useMemo(() => info?.games.map((g) => g.name) ?? [], [info]);
  const gameKey = gameNames.join(",");
  const historyKey = JSON.stringify(counts) + "|" + people.map((p) => `${p.slug}:${p.name}:${p.total}`).join(",") + "|" + (profile?.name ?? "");
  useEffect(() => {
    if (!gameKey || !profile) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      let failed = false;
      const rowsOf = async (g: string, who: string, sig: string) => {
        const k = g + "|" + who;
        const c = rowCache.current.get(k);
        if (c && c.sig === sig) return c.rows;
        try { const rows = await api.history(g, who); rowCache.current.set(k, { sig, rows }); return rows; }
        catch { failed = true; return c ? c.rows : ([] as RunSummary[]); }
      };
      const out: Record<string, Source[]> = {};
      await Promise.all(gameKey.split(",").map(async (g) => {
        const mine = await rowsOf(g, "", String(counts[g] ?? 0));
        const others = await Promise.all(people.map(async (p) => ({ key: p.slug, name: p.name, isMe: false, rows: await rowsOf(g, p.slug, String(p.counts[g] ?? 0)) })));
        out[g] = [{ key: "me", name: profile.name || "—", isMe: true, rows: mine }, ...others];
      }));
      if (!alive) return;
      setSources(out);
      setSourcesFail(failed);
      if (failed) retry = setTimeout(() => { if (alive) setSourcesTick((n) => n + 1); }, 8000);
    })();
    return () => { alive = false; if (retry) clearTimeout(retry); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, historyKey, sourcesTick]);
  const insights = useMemo(
    () => (sources ? gameNames.map((g) => buildInsight(g, sources[g] ?? [], blockedRules)) : null),
    [sources, blockedRules, gameNames],
  );
  const suggestionCount = insights ? insights.reduce((n, g) => n + g.suggestions.length, 0) : 0;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  }, [lang]);

  const loadBasics = useCallback(() => {
    api.profile().then(setProfile).catch(() => {});
    api.info().then((i) => {
      setInfo(i);
      setGame((g) => g || i.games.find((x) => x.enabled)?.name || "");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadBasics();
    void refreshSettings();
    void refreshPeople();
    void refreshBlocks();
    void refreshHistoryCount();
    // one request at a time per poll: a slow answer must not pile up more requests behind it
    let stateBusy = false, guardBusy = false, shareBusy = false, fails = 0;
    const poll = setInterval(() => {
      if (stateBusy) return;
      stateBusy = true;
      api.state().then(setState).catch(() => {}).finally(() => { stateBusy = false; });
    }, 1000);
    const guardPoll = setInterval(() => {
      if (guardBusy) return;
      guardBusy = true;
      api.guard().then(setGuard).catch(() => {}).finally(() => { guardBusy = false; });
    }, 3000);
    api.guard().then(setGuard).catch(() => {});
    // the heartbeat doubles as the "is the app still there?" check
    const beatOnce = () => api.heartbeat()
      .then(() => { fails = 0; setLost(false); })
      .catch(() => { fails++; if (fails >= 2) setLost(true); });
    const beat = setInterval(beatOnce, 3000);
    beatOnce();
    // friends' scans arrive by themselves: look at the local files and the sharing state every few seconds
    void refreshSync();
    const sharePoll = setInterval(() => {
      if (shareBusy) return;
      shareBusy = true;
      Promise.all([refreshSync(), refreshPeople(), refreshHistoryCount()]).finally(() => { shareBusy = false; });
    }, 6000);
    return () => { clearInterval(poll); clearInterval(guardPoll); clearInterval(beat); clearInterval(sharePoll); };
  }, [loadBasics, refreshBlocks, refreshHistoryCount, refreshSync, refreshPeople, refreshSettings]);

  // the name/games did not load (the app was still starting): try again until they do, so nothing stays a skeleton forever
  useEffect(() => {
    if (profile && info) return;
    const id = setInterval(loadBasics, 3000);
    return () => clearInterval(id);
  }, [profile, info, loadBasics]);

  // a finished scan adds a history entry; the same history feeds the "this range keeps being bad" suggestion
  useEffect(() => {
    if (state.phase !== "done") return;
    setScanRows([]);
    void refreshHistoryCount();
    api.history(state.game).then(setScanRows).catch(() => {});
    if (sync?.configured && sync.enabled) api.syncNow().catch(() => {});   // share the new scan with the group right away
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.game, refreshHistoryCount]);

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
    (code === "uac" ? t("errBlockUac") : code === "protected" ? t("errBlockProtected") : code === "busy" ? t("errBlockBusy") : t("errBlockFw")) + (detail ? "\n" + detail : "");

  // target = a single IP or a range such as 34.165.0.0/16
  const block = useCallback(async (s: ServerResult, gameName: string, target: string, whilePlaying: boolean) => {
    setFwError("");
    const r = await api.block(target, locationOf(s), gameName, whilePlaying && gameName ? "game" : "always").catch(() => ({ ok: false, error: "x" }));
    if (!r.ok) setFwError(fwMessage(r.error, (r as { detail?: string }).detail));
    await refreshBlocks();
    api.guard().then(setGuard).catch(() => {});
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

  const addManual = useCallback(async (target: string, gameName: string) => {
    setFwError("");
    const r = await api.block(target, "", gameName, gameName ? "game" : "always").catch(() => ({ ok: false, error: "x" } as { ok: boolean; error?: string; detail?: string }));
    if (!r.ok) setFwError(fwMessage(r.error, r.detail));
    await refreshBlocks();
    api.guard().then(setGuard).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBlocks, lang]);

  const guardStart = useCallback(async () => {
    setFwError("");
    const r = await api.guardStart().catch(() => ({ ok: false, error: "x" } as { ok: boolean; error?: string }));
    if (!r.ok) setFwError(r.error === "uac" ? t("errBlockUac") : t("errGuard"));
    setGuard(await api.guard().catch(() => guard));
    void refreshSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, guard]);

  const guardStop = useCallback(async () => {
    await api.guardStop().catch(() => {});
    setGuard(await api.guard().catch(() => guard));
    void refreshSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard]);

  const changeSetting = useCallback(async (key: "guardAuto" | "background" | "startup", value: boolean) => {
    setFwError("");
    setSettingBusy(key);
    const r = await api.settingsSet({ [key]: value }).catch(() => null);
    if (!r) setFwError(t("errGuard"));
    else if (r.ok === false) setFwError(r.error === "uac" ? t("errBlockUac") : r.error === "startup" ? `${t("errStartup")}\n${r.detail ?? ""}` : t("errGuard"));
    await refreshSettings();
    api.guard().then(setGuard).catch(() => {});
    setSettingBusy("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, refreshSettings]);

  // after an app update the installed copy of the guard is the old one until it is reinstalled
  const updateGuard = useCallback(async () => {
    setFwError("");
    setSettingBusy("startup");
    const r = await api.guardUpdate().catch(() => null);
    if (!r || !r.ok) setFwError(r?.error === "uac" ? t("errBlockUac") : `${t("errStartup")}\n${r?.detail ?? ""}`);
    await refreshSettings();
    api.guard().then(setGuard).catch(() => {});
    setSettingBusy("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, refreshSettings]);

  const syncBlocks = useCallback(async () => {
    const r = await api.blocksSync().catch(() => null);
    if (r) setBlocks(r);
  }, []);

  const p = state.phase;
  const running = p !== "idle" && p !== "done" && p !== "error";

  const start = async () => {
    if (!game) return;
    setBusy(true);
    setFwError("");
    const r = await api.start(game).catch(() => null);
    if (!r || !r.ok) setFwError(r?.error === "busy" ? t("errStartBusy") : t("errStart"));
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
    { id: "insights", label: t("tabInsights"), icon: Lightbulb, count: suggestionCount },
    { id: "blocked", label: t("tabBlocked"), icon: Ban, count: blocks.length },
  ];

  useEffect(() => {
    if (profile && !profile.name && !firstRunSeen.current) { firstRunSeen.current = true; setFirstRun(true); }
  }, [profile]);
  const modalOpen = firstRun || dialog !== null || adminOpen;

  // what the header chip says when sharing has a problem (the details are in Settings)
  const syncChipText = (s: SyncState) =>
    s.error === "code" ? t("syncChipCode") : s.error === "player" ? t("syncChipPlayer") : s.error === "full" ? t("syncChipFull")
    : s.error === "net" ? t("syncChipNet") : s.error ? t("syncChipServer") : t("syncChip");

  return (
    <>
      <div inert={modalOpen} className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-5 p-4 sm:p-6">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo className="size-10 shrink-0" />
            <div>
              <h1 className="text-lg leading-tight font-semibold">GameNetKit</h1>
              <p className="text-xs text-muted-foreground">
                {t("tagline")}
                {info && <> · {t("version")} <span className="num">{info.version}</span></>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile && (
              <Button variant="ghost" size="sm" onClick={() => setDialog("name")} title={t("profileEdit")}>
                <UserRound /> {profile.name || t("profileTitle")}
              </Button>
            )}
            {sync?.configured && sync.enabled && (
              <Status variant={sync.error ? "warning" : "success"} title={t("syncTitle")}>
                {syncChipText(sync)} {!sync.error && <span className="num">{sync.players}</span>}
              </Status>
            )}
            {guard.running && <Status variant="success" pulse title={t("guardText")}>{t("guardTitle")}</Status>}
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
            {settings && (
              <SettingsPopover
                t={t}
                settings={settings}
                busyKey={settingBusy}
                onChange={changeSetting}
                sync={sync}
                onSyncToggle={toggleSync}
                onChangeCode={() => setDialog("code")}
              />
            )}
          </div>
        </header>

        {lost && (
          <div role="alert" className="enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-destructive">{t("lostTitle")}</div>
              <p className="mt-1 text-xs text-foreground/80">{t("lostText")}</p>
            </div>
            <Button variant="destructive" onClick={() => window.location.reload()}>
              <RefreshCw /> {t("retry")}
            </Button>
          </div>
        )}

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
        <AnimatedTabs
          tabs={tabs.map((x) => {
            const Icon = x.icon;
            return { id: x.id, label: x.label, icon: <Icon />, count: x.count, countTone: x.id === "blocked" ? ("danger" as const) : ("neutral" as const) };
          })}
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          label="GameNetKit"
        />

        {settings && guard.running && guard.version && info && guard.version !== info.version && settings.taskInstalled && (
          <div className="enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("guardOutdated")} <span className="num text-xs text-muted-foreground">({guard.version} → {info.version})</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{t("guardOutdatedText")}</p>
            </div>
            <Button onClick={updateGuard} disabled={!!settingBusy}>
              <ShieldCheck /> {t("guardUpdateBtn")}
            </Button>
          </div>
        )}

        {fwError && (
          <div role="alert" className="enter sticky top-2 z-30 flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive shadow-lg">
            <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]" dir="auto">{fwError}</span>
            <button className="cursor-pointer opacity-70 hover:opacity-100" onClick={() => setFwError("")} aria-label={t("closeLabel")}><X className="size-4" /></button>
          </div>
        )}

        {/* the new section is mounted at once and eases in (continuity). No "wait for the old one to leave": if an animation ever
            stalls (minimized window), the content must still be there and usable. */}
        <motion.div
          key={tab}
          className="flex flex-1 flex-col gap-5"
          initial={{ opacity: 0.2, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
        >
        {tab === "history" && (
          <HistoryView
            t={t}
            games={gameNames}
            counts={counts}
            me={profile ?? { name: "", id: "", suggested: "", dataDir: "" }}
            people={people}
            isBlocked={isBlocked}
            isRangeBlocked={isRangeBlocked}
            onBlock={block}
            onUnblock={unblockFor}
            onChanged={refreshHistoryCount}
            onPeopleChanged={refreshPeople}
          />
        )}

        {tab === "insights" && (
          <InsightsView
            t={t}
            insights={insights}
            failed={sourcesFail}
            onRetry={() => setSourcesTick((n) => n + 1)}
            peopleCount={people.length}
            sharing={!!sync?.configured}
            onBlock={(s, g, range) => block(s, g, range, true)}
          />
        )}

        {tab === "blocked" && <BlockedView
            t={t}
            blocks={blocks}
            guard={guard}
            games={gameNames}
            onUnblock={unblockTarget}
            onUnblockAll={unblockAll}
            onAdd={addManual}
            onSync={syncBlocks}
            onGuardStart={guardStart}
            onGuardStop={guardStop}
          />}

        {tab === "scan" && (
          <main className="grid flex-1 gap-5 lg:grid-cols-[330px_1fr] xl:grid-cols-[360px_1fr]">
            {/* control + stepper */}
            <section className="flex flex-col gap-5 self-start rounded-xl border border-border bg-card p-5">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">{t("chooseGame")}</div>
                <div className="grid gap-2">
                  {!info && (<><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></>)}
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
                  <Button size="lg" variant="outline" onClick={() => api.begin().catch(() => setFwError(t("errGeneric")))}>
                    <Activity /> {t("beginManual")}
                  </Button>
                )}
                {running && (
                  <Button variant="destructive" onClick={() => api.cancel().catch(() => setFwError(t("errGeneric")))}>
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
            <section className="flex min-w-0 flex-col gap-4">
              {p === "error" && (
                <div className="enter rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                  <div className="text-sm font-medium text-destructive">{t("errorTitle")}</div>
                  <p className="mt-1 text-sm text-foreground/90">{errText}</p>
                  {state.error && <p className="num mt-1 text-xs text-muted-foreground" dir="ltr">{state.error}</p>}
                </div>
              )}

              {p === "done" && !best && (
                <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><Activity className="size-6" /></div>
                  <div>
                    <div className="text-sm font-medium">{t("doneEmptyTitle")}</div>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("errNoData")}</p>
                  </div>
                </div>
              )}

              {p === "done" && best && (
                <>
                  <div className="enter flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-semibold">{t("resultsTitle")} · {state.game}</h2>
                    <Button variant="secondary" size="sm" onClick={() => api.openFolder(state.game).catch(() => setFwError(t("errGeneric")))}>
                      <FolderOpen /> {t("openFolder")}
                    </Button>
                  </div>
                  <Suggestions
                    t={t}
                    items={suggestions(rangeStats(scanRows), isRangeBlocked)}
                    onBlock={(s, target) => block(s, state.game, target, true)}
                  />
                  <VerdictBanner best={best} t={t} />
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {state.results.map((s, i) => (
                      <ResultCard
                        key={s.ip}
                        s={s}
                        t={t}
                        first={i === 0}
                        delay={i * 60}
                        blocked={isBlocked(s.ip)}
                        game={state.game}
                        onBlock={(target, wp) => block(s, state.game, target, wp)}
                        onUnblock={() => unblockFor(s.ip)}
                      />
                    ))}
                  </div>
                </>
              )}

              {(p === "analyzing" || p === "measuring") && (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-live="polite">
                  <ServerCardSkeleton />
                  <ServerCardSkeleton />
                </div>
              )}

              {(p === "idle" || (running && p !== "analyzing" && p !== "measuring")) && (
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
        </motion.div>
      </div>

      {adminOpen && sync?.configured && (
        <AdminPanel t={t} unlocked={!!sync?.admin} onUnlocked={() => void refreshSync()} onLocked={() => void refreshSync()} onClose={() => setAdminOpen(false)} />
      )}

      {/* first run (no name yet) or "change name": outside the page, which is inert while this is open */}
      {profile && (firstRun || dialog) && (
        <ProfileDialog
          key={firstRun ? "first" : dialog ?? "name"}
          t={t}
          profile={profile}
          mode={firstRun ? "both" : dialog ?? "name"}
          required={firstRun}
          syncConfigured={!!sync?.configured}
          onSave={saveProfile}
          onClose={() => setDialog(null)}
        />
      )}
    </>
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
