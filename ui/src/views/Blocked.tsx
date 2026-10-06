import { useEffect, useState } from "react";
import { Ban, LoaderCircle, Play, Plus, RefreshCw, ShieldCheck, ShieldOff, Square } from "lucide-react";
import type { BlockEntry, GuardState } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { RowSkeleton } from "@/components/ui/skeleton";

type T = (k: Key) => string;

interface Props {
  t: T;
  blocks: BlockEntry[];
  guard: GuardState;
  /** every game the app knows, for the manual "only while this game runs" choice */
  games: string[];
  onUnblock: (target: string) => Promise<void>;
  onUnblockAll: () => Promise<void>;
  onAdd: (target: string, game: string) => Promise<void>;
  onSync: () => Promise<void>;
  onGuardStart: () => Promise<void>;
  onGuardStop: () => Promise<void>;
}

// public IPv4 address, or a range from /16 to /32 (the server validates again)
const TARGET = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:1[6-9]|2\d|3[0-2]))?$/;

export function BlockedView({ t, blocks, guard, games, onUnblock, onUnblockAll, onAdd, onSync, onGuardStart, onGuardStop }: Props) {
  const [busy, setBusy] = useState("");
  const [text, setText] = useState("");
  const [addGame, setAddGame] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // the list always reflects the real firewall rules when this tab opens
  useEffect(() => { void onSync().finally(() => setLoaded(true)); }, [onSync]);

  const work = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  };

  const add = async () => {
    const v = text.trim();
    if (!TARGET.test(v)) { setInvalid(true); return; }
    setInvalid(false);
    await work("add", async () => { await onAdd(v, addGame); setText(""); });
  };

  const gameBlocks = blocks.filter((b) => b.mode === "game");

  // group rules by the game they were made for (rules found in the firewall without a game go to "manual")
  const groups = new Map<string, BlockEntry[]>();
  for (const b of blocks) {
    const k = b.game || "";
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }

  const stateOf = (b: BlockEntry) =>
    b.mode !== "game" ? null
    : !guard.running ? { v: "default" as const, k: "stateGuardOff" as Key }
    : guard.applied.includes(b.ip) ? { v: "error" as const, k: "stateActive" as Key }
    : { v: "info" as const, k: "stateWaiting" as Key };

  return (
    <div className="flex flex-col gap-4">
      {/* guard */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("guardTitle")}</h3>
            <Status variant={guard.running ? "success" : "default"} pulse={guard.running}>{guard.running ? t("guardOn") : t("guardOff")}</Status>
          </div>
          {guard.running ? (
            <Button variant="secondary" size="sm" disabled={busy !== ""} onClick={() => work("gstop", onGuardStop)}>
              {busy === "gstop" ? <LoaderCircle className="animate-spin" /> : <Square />} {t("guardStop")}
            </Button>
          ) : (
            <Button size="sm" disabled={busy !== ""} onClick={() => work("gstart", onGuardStart)}>
              {busy === "gstart" ? <LoaderCircle className="animate-spin" /> : <Play />} {t("guardStart")}
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("guardText")}</p>
        {guard.running && guard.games.length > 0 && (
          <p className="text-xs"><span className="text-muted-foreground">{t("guardPlaying")}</span> <span className="font-medium">{guard.games.join(" · ")}</span></p>
        )}
        {!guard.running && gameBlocks.length > 0 && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{t("guardNeeded")}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("blockedTitle")} <span className="num text-sm font-normal text-muted-foreground">({blocks.length})</span></h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={() => work("sync", onSync)}>
            {busy === "sync" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} {t("syncRules")}
          </Button>
          {blocks.length > 0 && (
            <Button variant="secondary" size="sm" disabled={busy !== ""} onClick={() => work("*", onUnblockAll)}>
              {busy === "*" ? <LoaderCircle className="animate-spin" /> : <ShieldOff />} {t("unblockAll")}
            </Button>
          )}
        </div>
      </div>

      {/* add by hand */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("manualAdd")}</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setInvalid(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            placeholder={t("manualPlaceholder")}
            dir="ltr"
            className="num h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/60"
          />
          <select
            value={addGame}
            onChange={(e) => setAddGame(e.target.value)}
            aria-label={t("manualGame")}
            className="h-9 cursor-pointer rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <option value="">{t("manualNoGame")}</option>
            {games.map((g) => <option key={g} value={g}>{t("whilePlaying")} {g}</option>)}
          </select>
          <Button size="md" disabled={busy !== "" || text.trim() === ""} onClick={add}>
            {busy === "add" ? <LoaderCircle className="animate-spin" /> : <Plus />} {t("manualBlock")}
          </Button>
        </div>
        {invalid && <p className="mt-2 text-xs text-destructive">{t("manualInvalid")}</p>}
      </div>

      {!loaded && blocks.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy="true"><RowSkeleton /><div className="border-t border-border" /><RowSkeleton /></div>
      ) : blocks.length === 0 ? (
        <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><Ban className="size-6" /></div>
          <div>
            <div className="text-sm font-medium">{t("blockedEmpty")}</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("blockedEmptyText")}</p>
          </div>
        </div>
      ) : (
        [...groups.entries()].map(([game, list]) => (
          <div key={game || "manual"} className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">{game || t("noGame")}</div>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {list.map((b, i) => {
                const st = stateOf(b);
                return (
                  <div key={b.ip} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-sm font-medium">{b.ip}</span>
                        <Status variant="default">{b.mode === "game" ? `${t("modeGame")} ${b.game}` : t("modeAlways")}</Status>
                        {st && <Status variant={st.v} pulse={st.v === "error"}>{t(st.k)}</Status>}
                        {b.method === "route" && <Status variant="info" title={t("viaRouteHint")}>{t("viaRoute")}</Status>}
                      </div>
                      {b.method === "route" && <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">{t("viaRouteHint")}</p>}
                      <div className="mt-1 text-xs break-words text-muted-foreground">
                        {b.label}{b.label && b.time ? " · " : ""}{b.time && <>{t("since")} <span className="num">{b.time}</span></>}
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" disabled={busy !== ""} onClick={() => work(b.ip, () => onUnblock(b.ip))}>
                      {busy === b.ip ? <LoaderCircle className="animate-spin" /> : <ShieldOff />} {busy === b.ip ? t("blocking") : t("unblock")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">{t("removeNote")}</p>
    </div>
  );
}
