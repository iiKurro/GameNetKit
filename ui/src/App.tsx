import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Activity, Ban, Copy, Download, FolderOpen, Gamepad2, History as HistoryIcon, Lightbulb, LockKeyhole, Moon, Play, Radar, RefreshCw, Settings2, ShieldCheck, Square, Sun, UserRound, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ProfileDialog } from "@/components/ProfileDialog";
import { AdminPanel } from "@/components/AdminPanel";
import { motion } from "motion/react";
import { NavDock, ScanArt, HistoryArt, InsightsArt, BlockedArt, type DockItem } from "@/components/NavDock";
import { GameCarousel } from "@/components/GameCarousel";
import { Tilt } from "@/components/ui/tilt";
import type { GlobePoint, GlobeTone } from "@/components/Globe";
import { ScanGlobe, type ScanTarget } from "@/components/ScanGlobe";
import { GameBanner } from "@/components/GameBanner";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { codeOfName, countryName, guessHome, normalCode, placeOf } from "@/lib/geo";
import { SettingsView } from "@/views/SettingsView";
import { PromoPlayer } from "@/components/PromoPlayer";
import { api, type BlockEntry, type GuardState, type Info, type Person, type Phase, type Profile, type RunSummary, type Settings, type SyncState, type ServerResult, type State, type UpdateInfo } from "@/api";
import { makeT, type Lang } from "@/i18n";
import { applyDensity, applyTheme, loadDensity, loadTheme, type Density, type Theme } from "@/lib/prefs";
import { copyText, summaryText } from "@/lib/summary";
import { Scope } from "@/components/Scope";
import { Welcome } from "@/components/Welcome";
import { ProcessPicker } from "@/components/ProcessPicker";
import { cn } from "@/lib/utils";
import { covers } from "@/lib/cidr";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { VerticalStepper } from "@/components/ui/stepper";
import { ResultCard, locationOf, verdictLabel } from "@/components/ResultCard";
import { Suggestions } from "@/components/Suggestions";
import { InsightsView } from "@/views/Insights";
import { aggregate, buildInsight, rangeBlocked, type Source } from "@/lib/insights";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [density, setDensity] = useState<Density>(loadDensity);
  const [welcome, setWelcome] = useState(false);
  const [picker, setPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  // Ctrl+K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 7000);
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyDensity(density); }, [density]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [scanRows, setScanRows] = useState<RunSummary[]>([]);
  const [guard, setGuard] = useState<GuardState>({ running: false, games: [], applied: [] });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [dialog, setDialog] = useState<null | "code" | "password">(null);
  // first run: asked for the name (and the group code) once; stays open until everything was accepted
  const [firstRun, setFirstRun] = useState(false);
  const firstRunSeen = useRef(false);
  const needPasswordRef = useRef(false);
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

  // the dialog: first run (name + group code + password), a new group code, or the account password.
  // Returns a message when something must be fixed, "" when it is done.
  const loginError = useCallback((e?: string) =>
    e === "password" ? t("errPassword") : e === "short" ? t("errPwShort") : e === "tries" ? t("errTries") : e === "code" ? t("syncErrCode")
    : e === "net" ? t("syncErrNet") : e === "locked" ? t("errLocked") : t("errSaveCode"), [t]);

  const saveProfile = useCallback(async (name: string, code: string, password: string): Promise<string> => {
    if (firstRun) {
      const r = await api.accountStart(name, password, code).catch(() => null);
      if (!r) return t("errSaveName");
      if (!r.ok) return r.error === "name" ? t("errSaveName") : loginError(r.error);
      const p = await api.profile().catch(() => null);
      if (p) setProfile(p);
      await refreshSync();
      setDialog(null);
      setFirstRun(false);
      if (r.restored) say(t("restoredNote"));
      return "";
    }
    if (dialog === "password" || needPasswordRef.current) {
      const r = await api.accountPassword(password).catch(() => null);
      if (!r) return t("errSaveCode");
      if (!r.ok) return loginError(r.error);
      const p = await api.profile().catch(() => null);
      if (p) setProfile(p);
      await refreshSync();
      setDialog(null);
      return "";
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
    return "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun, dialog, t, loginError, refreshSync, say]);
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

  const changeSetting = useCallback(async (key: "guardAuto" | "background" | "startup" | "notify" | "sound", value: boolean) => {
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

  // the in-game panel: shortcut, corner, shown or not (no spinner: each is one quick call)
  const changeOverlay = useCallback(async (patch: Partial<Pick<Settings, "overlayKey" | "overlayCorner" | "overlayVisible">>) => {
    const r = await api.settingsSet(patch).catch(() => null);
    await refreshSettings();
    return !r ? "error" : r.ok === false ? (r.error ?? "error") : "";
  }, [refreshSettings]);

  // region lock of one game: the guard (elevated, already running) sees the switch within a couple of seconds, so no prompt here
  const changeRegionLock = useCallback(async (game: string, on: boolean) => {
    await api.settingsSet({ regionLock: { [game]: on } }).catch(() => null);
    await refreshSettings();
  }, [refreshSettings]);

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

  // the player says "this program is my game": remember it, then start the scan again so it looks for that program
  const pickProcess = async (name: string) => {
    const r = await api.addProcess(game, name).catch(() => null);
    if (!r || !r.ok) { setPicker(false); setFwError(t("errGeneric")); return; }
    setPicker(false);
    await api.cancel().catch(() => {});
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const st = await api.state().catch(() => null);
      if (st && (st.phase === "idle" || st.phase === "error" || st.phase === "done")) break;
    }
    loadBasics();
    const s = await api.start(game).catch(() => null);
    if (!s || !s.ok) setFwError(t("errStart"));
    else say(t("pickerSaved"));
  };

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
  const scanNet = scanRows[0]?.net ?? null;

  const scopeTitle = p === "idle" ? t("emptyTitle") : p === "elevating" || p === "waiting_game" ? t("launchGame") : p === "ready" ? t("joinMatch") : p === "capturing" ? t("capture") : t("analyze");
  const scopeText = p === "idle" ? t("emptyText") : p === "elevating" ? t("needAdmin") : p === "waiting_game" ? t("launchGameHint") : p === "ready" ? t("joinMatchHint") : p === "capturing" ? t("captureHint") : t("analyzeHint");

  const copySummary = async () => {
    const text = summaryText({ game: state.game, time: scanRows[0]?.time ?? "", results: state.results, net: scanNet }, t, profile?.name ?? "");
    say((await copyText(text)) ? t("copied") : t("copyFail"));
  };
  const copyDiagnostics = useCallback(async (): Promise<string> => {
    const r = await api.diagnostics().catch(() => null);
    if (!r || !r.ok) return t("copyFail");
    return (await copyText(r.text)) ? "" : t("copyFail");
  }, [t]);

  // a Windows notification (and sound, if enabled) while the player is inside the game; nothing when the app is the active window
  const prevPhase = useRef<Phase>("idle");
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = state.phase;
    if (prev === state.phase || document.hasFocus()) return;
    if (state.phase === "capturing" && (prev === "ready" || prev === "waiting_game")) void api.notify(t("notifyStartTitle"), t("notifyStartText")).catch(() => {});
    else if (state.phase === "done" && state.results[0]) {
      const b = state.results[0];
      const where = b.city && b.city !== "?" ? b.city : b.country;
      void api.notify(`${t("notifyDoneTitle")} · ${state.game}`, `${where} · ${b.avg != null ? (b.via ? "≈ " : "") + b.avg + " ms" : t("noReply")} · ${verdictLabel(b.verdict, t)}`).catch(() => {});
    } else if (state.phase === "error" && state.errorCode !== "cancelled") void api.notify(t("notifyErrTitle"), errText).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // the notification-area icon follows the language of the window
  useEffect(() => {
    void api.trayLabels({ open: t("trayOpen"), guardOn: t("trayGuardOn"), guardOff: t("trayGuardOff"), exit: t("trayExit"), ...Object.fromEntries((["ovPing", "ovJitter", "ovLoss", "ovNone", "ovHudHint", "ovMenuHint", "ovCmdScan", "ovCmdBlock", "ovCmdUnblock", "ovCmdUnblockAll", "ovDone", "ovBusy", "ovUac", "ovFail"] as const).map((k) => [k, t(k)])) }).catch(() => {});
  }, [t]);

  const commands: Command[] = [
    ...(running
      ? [{ id: "cancel", group: t("cmdGroupActions"), label: t("cancel"), icon: <Square />, run: () => { void api.cancel().catch(() => setFwError(t("errGeneric"))); } }]
      : game ? [{ id: "scan", group: t("cmdGroupActions"), label: `${t("start")} · ${game}`, icon: <Play />, run: () => { setSettingsOpen(false); setTab("scan"); void start(); } }] : []),
    { id: "theme", group: t("cmdGroupActions"), label: theme === "dark" ? t("themeToLight") : t("themeToDark"), icon: theme === "dark" ? <Sun /> : <Moon />, run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "settings", group: t("cmdGroupActions"), label: t("settingsTitle"), icon: <Settings2 />, run: () => setSettingsOpen(true) },
    { id: "go-scan", group: t("cmdGroupGo"), label: t("tabScan"), icon: <Radar />, run: () => { setSettingsOpen(false); setTab("scan"); } },
    { id: "go-history", group: t("cmdGroupGo"), label: t("tabHistory"), icon: <HistoryIcon />, hint: String(historyCount), run: () => { setSettingsOpen(false); setTab("history"); } },
    { id: "go-insights", group: t("cmdGroupGo"), label: t("tabInsights"), icon: <Lightbulb />, run: () => { setSettingsOpen(false); setTab("insights"); } },
    { id: "go-blocked", group: t("cmdGroupGo"), label: t("tabBlocked"), icon: <Ban />, hint: String(blocks.length), run: () => { setSettingsOpen(false); setTab("blocked"); } },
    ...(running ? [] : (info?.games.filter((g) => g.enabled) ?? []).map((g) => ({
      id: `game-${g.name}`, group: t("cmdGroupGames"), label: g.name, icon: <Gamepad2 />, hint: (counts[g.name] ?? 0) > 0 ? String(counts[g.name]) : undefined,
      run: () => { setSettingsOpen(false); setTab("scan"); setGame(g.name); },
    }))),
  ];

  const dock: DockItem[] = [
    { id: "scan", label: t("tabScan"), art: <ScanArt />, tint: "text-primary" },
    { id: "history", label: t("tabHistory"), art: <HistoryArt />, tint: "text-info", count: historyCount },
    { id: "insights", label: t("tabInsights"), art: <InsightsArt />, tint: "text-warning", count: suggestionCount },
    { id: "blocked", label: t("tabBlocked"), art: <BlockedArt />, tint: "text-destructive", count: blocks.length, danger: true },
  ];

  // ---- the globe: where the player is, and the servers of the matches
  const toneOf = (verdict: string, avg: number | null): GlobeTone => (avg == null ? "idle" : verdict === "bad" ? "bad" : verdict === "ok" ? "ok" : verdict === "good" ? "good" : "idle");
  const homeCode = useMemo(() => {
    const mine = sources ? Object.values(sources).flatMap((list) => list.find((s) => s.isMe)?.rows ?? []) : [];
    const named = mine.find((r) => r.net?.country)?.net?.country;
    return codeOfName(named) || codeOfName(scanRows[0]?.net?.country) || guessHome();
  }, [sources, scanRows]);
  const globeOrigin = homeCode ? { cc: homeCode, label: countryName(homeCode, lang) } : null;
  // the scan globe: each server of the last match where it really is (a point in its city; the middle of the country for an old scan)
  const scanTargets: ScanTarget[] = useMemo(() => state.results.flatMap((s) => {
    const pl = placeOf({ lat: s.lat, lon: s.lon, cc: normalCode(s.cc || codeOfName(s.country)) });
    return pl ? [{ id: s.ip, lat: pl[0], lon: pl[1], tone: toneOf(s.verdict, s.avg) }] : [];
  }), [state.results]);   // eslint-disable-line react-hooks/exhaustive-deps
  const homePlace = useMemo(() => {
    const n = scanNet ?? scanRows[0]?.net ?? null;
    if (n && typeof n.lat === "number" && typeof n.lon === "number") return { lat: n.lat, lon: n.lon };
    const c = placeOf({ cc: homeCode });
    return c ? { lat: c[0], lon: c[1] } : null;
  }, [scanNet, scanRows, homeCode]);
  const slugOf = (name: string) => info?.games.find((g) => g.name === name)?.slug;
  const scanPlaceText = (() => {
    const b = state.results[0];
    const pl = b ? placeOf({ lat: b.lat, lon: b.lon, cc: normalCode(b.cc || codeOfName(b.country)) }) : null;
    return pl ? `${Math.abs(pl[0]).toFixed(2)}°${pl[0] >= 0 ? "N" : "S"} · ${Math.abs(pl[1]).toFixed(2)}°${pl[1] >= 0 ? "E" : "W"}` : "";
  })();

  // everybody's matches, one marker per country
  const allPoints: GlobePoint[] = useMemo(() => {
    if (!sources) return [];
    const by = new Map<string, { n: number; bad: number; sum: number; counted: number }>();
    for (const list of Object.values(sources)) {
      for (const r of aggregate(list)) {
        const cc = normalCode(r.sample.cc || codeOfName(r.sample.country));
        if (!cc) continue;
        const e = by.get(cc) ?? { n: 0, bad: 0, sum: 0, counted: 0 };
        e.n += r.matches; e.bad += r.bad;
        if (r.avg != null) { e.sum += r.avg * r.matches; e.counted += r.matches; }
        by.set(cc, e);
      }
    }
    return [...by.entries()].map(([cc, e]) => {
      const avg = e.counted ? Math.round(e.sum / e.counted) : null;
      const tone: GlobeTone = avg == null ? "idle" : e.bad / Math.max(1, e.n) >= 0.25 || avg >= 100 ? "bad" : avg >= 60 ? "ok" : "good";
      return { id: cc, cc, label: countryName(cc, lang), tone, detail: avg != null ? `${avg} ms` : undefined };
    });
  }, [sources, lang]);

  useEffect(() => {
    if (profile && !profile.name && !firstRunSeen.current) { firstRunSeen.current = true; setFirstRun(true); setWelcome(true); }
  }, [profile]);
  // an account that shares with the group but has no password yet must choose one (it is how it is logged into from any PC)
  const needPassword = !!profile?.name && !!sync?.configured && !!sync.hasCode && !sync.hasPassword && !firstRun;
  needPasswordRef.current = needPassword;
  const modalOpen = palette || picker || welcome || firstRun || needPassword || dialog !== null || adminOpen;
  const relogin = !!sync?.hasPassword && (sync.error === "player" || sync.error === "taken");

  // what the header chip says when sharing has a problem (the details are in Settings)
  const syncChipText = (s: SyncState) =>
    s.error === "code" ? t("syncChipCode") : s.error === "taken" ? t("syncChipTaken") : s.error === "player" ? t("syncChipPlayer") : s.error === "full" ? t("syncChipFull")
    : s.error === "net" ? t("syncChipNet") : s.error ? t("syncChipServer") : t("syncChip");

  return (
    <>
      <div inert={modalOpen} className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-5 px-4 pb-6 sm:px-6">
        {/* header: the mark, the state of things as quiet chips, and the few controls that are used all the time */}
        <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="size-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg leading-tight font-extrabold" dir="ltr">GameNetKit</h1>
              <p className="hide-compact text-xs text-muted-foreground">
                {t("tagline")}
                {info && <> · <span className="num">{info.version}</span></>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile?.name && (
              <span className="inline-flex h-8 items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground" title={t("profileFixed")}>
                <UserRound className="size-4" /> {profile.name}
              </span>
            )}
            {sync?.configured && sync.enabled && (
              <Status variant={sync.error ? "warning" : "success"} title={t("syncTitle")}>
                {syncChipText(sync)} {!sync.error && <span className="num">{sync.players}</span>}
              </Status>
            )}
            {relogin && <Button variant="outline" size="sm" onClick={() => setDialog("password")}><LockKeyhole /> {t("loginAgain")}</Button>}
            {guard.running && <Status variant="success" pulse title={t("guardText")}>{t("guardTitle")}</Status>}
            {updPhase === "checking" && <Status variant="info" pulse>{t("checking")}</Status>}
            {updPhase === "idle" && upd?.hasUpdate && <Status variant="warning" pulse>{t("updateAvail")} <span className="num">{upd.latest}</span></Status>}
            {updPhase === "idle" && upd?.error && <Status variant="error">{t("updateFail")}</Status>}
            <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />
            <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("themeToLight") : t("themeToDark")} title={theme === "dark" ? t("themeToLight") : t("themeToDark")}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPalette(true)} aria-label={t("cmdTitle")} title={t("cmdTitle")}>
              <Search /> <kbd className="hide-compact rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground" dir="ltr">Ctrl K</kbd>
            </Button>
            {settings && (
              <Button variant={settingsOpen ? "secondary" : "ghost"} size="sm" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
                <Settings2 /> {t("settingsTitle")}
              </Button>
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

        {/* tabs (the settings page replaces them while it is open) */}
        {!settingsOpen && <NavDock items={dock} active={tab} onChange={(id) => setTab(id as Tab)} label="GameNetKit" />}

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

        {notice && (
          <div role="status" className="enter flex items-start justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <span className="min-w-0" dir="auto">{notice}</span>
            <button className="cursor-pointer opacity-70 hover:opacity-100" onClick={() => setNotice("")} aria-label={t("closeLabel")}><X className="size-4" /></button>
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
        {settingsOpen && settings && (
          <SettingsView
            t={t}
            onBack={() => setSettingsOpen(false)}
            lang={lang} onLang={setLang}
            theme={theme} onTheme={setTheme}
            density={density} onDensity={setDensity}
            settings={settings}
            busyKey={settingBusy}
            onChange={changeSetting}
            onOverlay={changeOverlay}
            games={info?.games.filter((g) => g.enabled).map((g) => g.name) ?? []}
            onRegionLock={changeRegionLock}
            guard={guard}
            sync={sync}
            onSyncToggle={toggleSync}
            onChangeCode={() => setDialog("code")}
            onChangePassword={() => setDialog("password")}
            profile={profile}
            version={info?.version ?? ""}
            upd={upd}
            updPhase={updPhase}
            onCheckUpdate={checkUpdate}
            onDiagnostics={copyDiagnostics}
            onWelcome={() => setWelcome(true)}
          />
        )}
        {!settingsOpen && (
        <motion.div
          key={tab}
          className="flex flex-1 flex-col gap-5"
          style={{ transformOrigin: "50% 0%" }}
          initial={{ opacity: 0.15, y: 12, rotateX: 5, transformPerspective: 1500 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
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
            globe={{ origin: globeOrigin, points: allPoints }}
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
          <>
          {/* the games, across the page, under the dock */}
          {!info && <Skeleton className="h-[240px] w-full rounded-2xl" />}
          {info && <p className="-mb-2 text-center text-xs text-muted-foreground">{t("pickYourGame")}</p>}
          {info && (
            <GameCarousel
              games={info.games.filter((g) => g.enabled)}
              value={game}
              onChange={setGame}
              disabled={running}
              counts={counts}
              rtl={lang === "ar"}
              label={t("chooseGame")}
              countText={(n) => `${n} ${t("tabHistory")}`}
            />
          )}
          <main className="grid flex-1 gap-5 lg:grid-cols-[330px_1fr] xl:grid-cols-[360px_1fr]">
            {/* control + stepper */}
            <section className="lift flex flex-col gap-5 self-start rounded-2xl border border-border bg-card p-5">
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

              <div className="hide-compact"><VerticalStepper steps={steps} current={stepCurrent} loading={running && p !== "ready"} done={p === "done"} /></div>
              <div className="hide-compact"><PromoPlayer t={t} compact className="min-h-[150px]" /></div>
            </section>

            {/* the stage: the scope while a scan runs, the match server's wire and the other servers when it is done */}
            <section className="flex min-w-0 flex-col gap-4">
              {p === "error" && (
                <div role="alert" className="enter rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
                  <div className="text-sm font-semibold text-destructive">{t("errorTitle")}</div>
                  <p className="mt-1 text-sm text-foreground/90">{errText}</p>
                  {state.error && <p className="num mt-1 text-xs text-muted-foreground" dir="ltr">{state.error}</p>}
                </div>
              )}

              {(p === "idle" || p === "error" || running) && (
                <div className="enter lift overflow-hidden rounded-2xl border border-border bg-card/70">
                  <Scope
                    phase={p === "error" ? "idle" : p} ports={state.ports} secondsLeft={state.secondsLeft} portsText={t("portsSeen")} title={scopeTitle} text={scopeText}
                    game={running ? game : undefined} help={{ label: t("pickerOpen"), onClick: () => setPicker(true) }}
                    home={homePlace}
                    banner={game ? <GameBanner name={game} slug={slugOf(game)} note={(counts[game] ?? 0) > 0 ? `${counts[game]} ${t("tabHistory")}` : undefined} /> : undefined}
                  />
                </div>
              )}

              {p === "done" && !best && (
                <div className="enter flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><Activity className="size-6" /></div>
                  <div>
                    <div className="text-sm font-semibold">{t("doneEmptyTitle")}</div>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("errNoData")}</p>
                  </div>
                </div>
              )}

              {p === "done" && best && (
                <>
                  <div className="enter flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-extrabold">{t("resultsTitle")} · {state.game}</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={copySummary}><Copy /> {t("copySummary")}</Button>
                      <Button variant="secondary" size="sm" onClick={() => api.openFolder(state.game).catch(() => setFwError(t("errGeneric")))}>
                        <FolderOpen /> {t("openFolder")}
                      </Button>
                    </div>
                  </div>
                  {scanTargets.some((x) => x.id === best.ip) && (
                    <div className="enter lift overflow-hidden rounded-2xl border border-border bg-card/70">
                      <GameBanner name={state.game} slug={slugOf(state.game)} />
                      <ScanGlobe mode="locked" targets={scanTargets} lockId={best.ip} home={homePlace} label={t("scanLocated")} className="relative -mt-14 h-[350px] w-full">
                        {/* the card beside the point the globe locked on to: it appears when the frame has closed */}
                        <div className="enter pointer-events-none absolute top-[calc(50%-92px)] flex max-w-[15rem] flex-col gap-1 rounded-xl border border-border bg-card/90 px-3.5 py-2.5 text-start shadow-lg backdrop-blur" style={{ left: "calc(50% + 62px)", animationDelay: "1.9s", animationFillMode: "both" }}>
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary"><span className="size-1.5 rounded-full bg-primary" /> {t("scanLocated")}</span>
                          <span className="text-sm font-extrabold" dir="auto">{best.city && best.city !== "?" ? `${best.city} · ` : ""}{best.country}</span>
                          <span className="num text-[11px] text-muted-foreground" dir="ltr">{scanPlaceText}</span>
                          {typeof best.lat !== "number" && <span className="text-[11px] text-warning">{t("scanLocatedApprox")}</span>}
                          <span className="num text-xs font-semibold" dir="ltr">{best.avg != null ? `${best.via ? "≈ " : ""}${best.avg} ms` : "—"}</span>
                        </div>
                      </ScanGlobe>
                    </div>
                  )}
                  <Suggestions
                    t={t}
                    items={suggestions(rangeStats(scanRows), isRangeBlocked)}
                    onBlock={(s, target) => block(s, state.game, target, true)}
                  />
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {state.results.map((s, i) => (
                      <Tilt key={s.ip} max={i === 0 ? 2.5 : 5} className={i === 0 ? "md:col-span-2 2xl:col-span-3" : undefined}>
                        <ResultCard
                          s={s}
                          t={t}
                          first={i === 0}
                          hero={i === 0}
                          isp={scanNet?.isp}
                          delay={i * 60}
                          blocked={isBlocked(s.ip)}
                          game={state.game}
                          onBlock={(target, wp) => block(s, state.game, target, wp)}
                          onUnblock={() => unblockFor(s.ip)}
                        />
                      </Tilt>
                    ))}
                  </div>
                </>
              )}

              <div className="hide-compact rounded-2xl border border-border bg-card/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="size-4 text-primary" /> {t("howTitle")}
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>• {t("how1")}</li>
                  <li>• {t("how2")}</li>
                  <li>• {t("how3")}</li>
                </ul>
              </div>
            </section>
          </main>
          </>
        )}
        </motion.div>
        )}
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} placeholder={t("cmdPlaceholder")} empty={t("cmdEmpty")} title={t("cmdTitle")} />

      {adminOpen && sync?.configured && (
        <AdminPanel t={t} unlocked={!!sync?.admin} onUnlocked={() => void refreshSync()} onLocked={() => void refreshSync()} onClose={() => setAdminOpen(false)} />
      )}

      {/* first run (no name yet) or "change name": outside the page, which is inert while this is open */}
      {welcome && <Welcome t={t} rtl={lang === "ar"} onDone={() => setWelcome(false)} />}

      {picker && <ProcessPicker t={t} game={game} onPick={pickProcess} onClose={() => setPicker(false)} />}

      {profile && !welcome && (firstRun || needPassword || dialog) && (
        <ProfileDialog
          key={firstRun ? "first" : needPassword ? "pw-required" : dialog ?? "code"}
          t={t}
          profile={profile}
          mode={firstRun ? "both" : needPassword ? "password" : dialog ?? "code"}
          required={firstRun || needPassword}
          syncConfigured={!!sync?.configured}
          onSave={saveProfile}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
