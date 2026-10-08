import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Bell, Check, Cloud, Copy, KeyRound, Layers, Moon, Palette, RefreshCw, ShieldCheck, Sun, Info, UserRound, Volume2 } from "lucide-react";
import type { GuardState, Profile, Settings, SyncState, UpdateInfo } from "@/api";
import type { Key } from "@/i18n";
import type { Lang } from "@/i18n";
import type { Density, Theme } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Status } from "@/components/ui/status";
import { SettingGroup, SettingRow } from "@/components/SettingRow";
import { OverlaySettings } from "@/components/OverlaySettings";
import { PromoPlayer } from "@/components/PromoPlayer";
import { Logo } from "@/components/Logo";

type T = (k: Key) => string;
export type SectionId = "general" | "alerts" | "protect" | "overlay" | "share" | "about";

interface Props {
  t: T;
  /** which section opens first */
  start?: SectionId;
  onBack: () => void;
  lang: Lang;
  onLang: (l: Lang) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  density: Density;
  onDensity: (d: Density) => void;
  settings: Settings;
  /** the row waiting for an answer (an admin prompt can take a while) */
  busyKey: string;
  onChange: (key: "guardAuto" | "background" | "startup" | "notify" | "sound", value: boolean) => void;
  onOverlay: (patch: Partial<Pick<Settings, "overlayKey" | "overlayCorner" | "overlayVisible">>) => Promise<string>;
  /** the games the region lock can be set for, and the switch itself */
  games: string[];
  onRegionLock: (game: string, on: boolean) => void;
  guard: GuardState;
  sync: SyncState | null;
  onSyncToggle: (enabled: boolean) => void;
  onChangeCode: () => void;
  onChangePassword: () => void;
  profile: Profile | null;
  version: string;
  upd: UpdateInfo | null;
  updPhase: "idle" | "checking" | "updating";
  onCheckUpdate: () => void;
  onDiagnostics: () => Promise<string>;
  onWelcome: () => void;
}

export function SettingsView(p: Props) {
  const { t } = p;
  const [section, setSection] = useState<SectionId>(p.start ?? "general");
  const reduce = useReducedMotion();
  const heading = useRef<HTMLHeadingElement>(null);

  // the whole page is one place: Esc goes back, and the heading takes the focus when a section changes (screen readers read where they are)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) p.onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const nav: { id: SectionId; icon: typeof Palette; title: Key; hint: Key }[] = [
    { id: "general", icon: Palette, title: "svGeneral", hint: "svGeneralHint" },
    { id: "alerts", icon: Bell, title: "svAlerts", hint: "svAlertsHint" },
    { id: "protect", icon: ShieldCheck, title: "svProtect", hint: "svProtectHint" },
    { id: "overlay", icon: Layers, title: "svOverlay", hint: "svOverlayHint" },
    { id: "share", icon: Cloud, title: "svShare", hint: "svShareHint" },
    { id: "about", icon: Info, title: "svAbout", hint: "svAboutHint" },
  ];
  const current = nav.find((n) => n.id === section)!;
  const BackIcon = ArrowRight;

  return (
    <div className="enter flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={p.onBack} aria-label={t("svBack")}>
          <BackIcon className="rtl:rotate-0 ltr:rotate-180" /> {t("svBack")}
        </Button>
        <h2 className="text-lg font-extrabold">{t("settingsTitle")}</h2>
      </div>

      <div className="grid flex-1 items-start gap-5 md:grid-cols-[260px_1fr] lg:grid-cols-[290px_1fr]">
        <nav aria-label={t("svSections")} className="flex gap-1.5 overflow-x-auto md:sticky md:top-24 md:flex-col md:overflow-visible">
          {nav.map((n) => {
            const Icon = n.icon, on = n.id === section;
            return (
              <button
                key={n.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => { setSection(n.id); heading.current?.focus({ preventScroll: true }); }}
                className={cn(
                  "group flex shrink-0 cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-start transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/60 md:w-full",
                  on ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-accent",
                )}
              >
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors", on ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-muted text-muted-foreground group-hover:text-foreground")}>
                  <Icon className="size-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold", on ? "text-foreground" : "text-foreground/90")}>{t(n.title)}</span>
                  <span className="hide-compact mt-0.5 hidden truncate text-xs text-muted-foreground md:block">{t(n.hint)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <motion.section
          key={section}
          className="flex min-w-0 flex-col gap-4"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        >
          <div>
            <h3 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">{t(current.title)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(current.hint)}</p>
          </div>
          {section === "general" && <General {...p} />}
          {section === "alerts" && <Alerts {...p} />}
          {section === "protect" && <Protect {...p} />}
          {section === "overlay" && <OverlaySettings t={t} settings={p.settings} onChange={p.onOverlay} />}
          {section === "share" && <Share {...p} />}
          {section === "about" && <About {...p} />}
        </motion.section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- sections

function General({ t, lang, onLang, theme, onTheme, density, onDensity, onWelcome, onBack }: Props) {
  return (
    <SettingGroup>
      <SettingRow
        title={t("svLangTitle")} hint={t("svLangHint")}
        control={<Segmented label={t("svLangTitle")} value={lang} onChange={onLang} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />}
      />
      <SettingRow
        title={t("svThemeTitle")} hint={t("svThemeHint")}
        control={<Segmented label={t("svThemeTitle")} value={theme} onChange={onTheme} options={[{ value: "dark", label: t("svDark"), icon: <Moon /> }, { value: "light", label: t("svLight"), icon: <Sun /> }]} />}
      />
      <SettingRow
        title={t("svDensityTitle")} hint={t("svDensityHint")}
        control={<Segmented label={t("svDensityTitle")} value={density} onChange={onDensity} options={[{ value: "comfortable", label: t("svComfortable") }, { value: "compact", label: t("svCompact") }]} />}
      />
      <SettingRow
        title={t("svTourTitle")} hint={t("svTourHint")}
        control={<Button variant="outline" size="sm" onClick={() => { onBack(); onWelcome(); }}>{t("svTourBtn")}</Button>}
      />
    </SettingGroup>
  );
}

function Alerts({ t, settings, busyKey, onChange }: Props) {
  return (
    <SettingGroup>
      <SettingRow
        id="set-notify" title={t("notifyTitle")} hint={t("svNotifyHint")}
        control={<Switch checked={settings.notify} busy={busyKey === "notify"} disabled={!!busyKey} aria-labelledby="set-notify" onChange={(v) => onChange("notify", v)} />}
      />
      <SettingRow
        id="set-sound" title={t("soundTitle")} hint={t("svSoundHint")}
        control={<Switch checked={settings.sound} busy={busyKey === "sound"} disabled={!!busyKey || !settings.notify} aria-labelledby="set-sound" onChange={(v) => onChange("sound", v)} />}
      />
    </SettingGroup>
  );
}

function Protect({ t, settings, busyKey, onChange, guard, games, onRegionLock }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        <Status variant={guard.running ? "success" : "info"} pulse={guard.running}>{guard.running ? t("svGuardNow") : t("svGuardIdle")}</Status>
      </div>
      <SettingGroup>
        <SettingRow
          id="set-guardAuto" title={t("setGuardTitle")} hint={t("svGuardAutoHint")}
          control={<Switch checked={settings.guardAuto} busy={busyKey === "guardAuto"} disabled={!!busyKey} aria-labelledby="set-guardAuto" onChange={(v) => onChange("guardAuto", v)} />}
        />
        <SettingRow
          id="set-background" title={t("setBgTitle")} hint={t("svBgHint")}
          control={<Switch checked={settings.background} busy={busyKey === "background"} disabled={!!busyKey || settings.startup} aria-labelledby="set-background" onChange={(v) => onChange("background", v)} />}
        />
        <SettingRow
          id="set-startup" title={t("setStartTitle")} hint={t("svStartHint")}
          tone={settings.startupDisabled ? "warning" : "normal"}
          control={<Switch checked={settings.startup} busy={busyKey === "startup"} disabled={!!busyKey} aria-labelledby="set-startup" onChange={(v) => onChange("startup", v)} />}
        >
          {settings.startup ? (settings.startupDisabled ? t("setStartOffByUser") : t("setStartListed")) : t("setNoteAdmin")}
        </SettingRow>
      </SettingGroup>

      {games.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-extrabold">{t("rlTitle")}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("rlHint")}</p>
          <SettingGroup>
            {games.map((g, i) => {
              const on = !!settings.regionLock?.[g];
              const active = !!guard.regionLocked?.includes(g);
              return (
                <SettingRow
                  key={g}
                  id={`set-rl-${i}`} title={g} hint={active ? t("rlActive") : on ? (guard.running ? t("rlWaiting") : t("rlNeedsGuard")) : t("rlOff")}
                  tone={on && !guard.running ? "warning" : "normal"}
                  control={<Switch checked={on} aria-labelledby={`set-rl-${i}`} onChange={(v) => onRegionLock(g, v)} />}
                />
              );
            })}
          </SettingGroup>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("rlWarn")}</p>
        </div>
      )}
    </div>
  );
}

function Share({ t, sync, onSyncToggle, onChangeCode, onChangePassword, profile }: Props) {
  if (!sync?.configured) return <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">{t("svNoShare")}</p>;
  const problem = sync.error;
  const status = !sync.hasCode ? t("syncNoCode")
    : !sync.enabled ? t("syncOff")
    : sync.error === "code" ? t("syncErrCode")
    : sync.error === "full" ? t("syncErrFull")
    : sync.error === "taken" ? t("syncErrTaken")
    : sync.error === "player" ? t("syncErrPlayer")
    : sync.error === "net" ? t("syncErrNet")
    : sync.error ? t("syncErrServer")
    : sync.lastOkSecondsAgo < 0 ? t("checking")
    : null;
  return (
    <div className="flex flex-col gap-4">
      <SettingGroup>
        <SettingRow
          id="set-sync" title={t("syncTitle")} hint={t("svSyncHint")}
          tone={problem ? "warning" : "normal"}
          control={<Switch checked={sync.enabled} disabled={!sync.hasCode} aria-labelledby="set-sync" onChange={(v) => onSyncToggle(v)} />}
        >
          {status ?? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-success">{t("syncOk")}</span>
              <span>· {t("syncAgo")} <span className="num">{sync.lastOkSecondsAgo}</span> {t("syncSec")}</span>
              <span>· <span className="num">{sync.players}</span> {t("syncPlayers")}</span>
              <span>· <span className="num">{sync.uploaded}</span> {t("syncUploaded")}</span>
            </span>
          )}
        </SettingRow>
        <SettingRow
          title={t("svCodeTitle")} hint={sync.hasCode ? t("svCodeHintSet") : t("svCodeHintNone")}
          control={<Button variant="outline" size="sm" onClick={onChangeCode}><KeyRound /> {sync.hasCode ? t("syncChangeCode") : t("syncEnterCode")}</Button>}
        />
      </SettingGroup>
      {profile?.name && (
        <SettingGroup>
          <SettingRow
            title={t("svAccountTitle")} hint={t("svAccountFixed")}
            control={<span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-sm font-semibold"><UserRound className="size-4 text-muted-foreground" /> {profile.name}</span>}
          />
          <SettingRow
            title={t("svPasswordTitle")} hint={t("svPasswordHint")}
            control={<Button variant="outline" size="sm" onClick={onChangePassword}>{t("svPasswordBtn")}</Button>}
          />
        </SettingGroup>
      )}
    </div>
  );
}

function About({ t, version, upd, updPhase, onCheckUpdate, onDiagnostics }: Props) {
  const [diag, setDiag] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const copy = async () => {
    setDiag("busy");
    const err = await onDiagnostics();
    setDiag(err ? "fail" : "done");
    setTimeout(() => setDiag("idle"), 4000);
  };
  const state: ReactNode =
    updPhase === "checking" ? t("checking")
    : upd?.hasUpdate ? <span className="text-warning">{t("updateAvail")} <span className="num">{upd.latest}</span></span>
    : upd?.error ? <span className="text-destructive">{t("updateFail")}</span>
    : upd ? <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" /> {t("upToDate")}</span>
    : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="lift flex items-center gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <Logo className="size-14 shrink-0" />
        <div className="min-w-0">
          <div className="text-lg font-extrabold" dir="ltr">GameNetKit</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{t("svVersion")} <span className="num font-semibold text-foreground">{version}</span></div>
        </div>
        <div className="ms-auto flex flex-col items-end gap-1.5 text-xs">
          {state}
          <Button variant="outline" size="sm" onClick={onCheckUpdate} disabled={updPhase !== "idle"}>
            <RefreshCw className={cn(updPhase === "checking" && "animate-spin")} /> {t("svCheckBtn")}
          </Button>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold">{t("svIntroTitle")}</h4>
        <p className="mb-2.5 mt-0.5 text-xs text-muted-foreground">{t("svIntroHint")}</p>
        <PromoPlayer t={t} className="max-w-3xl" />
      </div>

      <SettingGroup>
        <SettingRow
          title={t("svDiagTitle")} hint={t("svDiagHint")}
          control={<Button variant="outline" size="sm" onClick={copy} disabled={diag === "busy"}><Copy /> {t("copyDiag")}</Button>}
        >
          {diag === "done" && <span role="status" className="text-success">{t("diagDone")}</span>}
          {diag === "fail" && <span role="status" className="text-destructive">{t("copyFail")}</span>}
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
