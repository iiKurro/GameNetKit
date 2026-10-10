import { useEffect, useState } from "react";
import { Ban, LoaderCircle, ShieldOff } from "lucide-react";
import type { ServerResult } from "@/api";
import type { Key } from "@/i18n";
import { rangeOf } from "@/lib/cidr";
import { Flag } from "@/lib/flags";
import { isV6 } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LinkStrip } from "@/components/LinkStrip";
import { Status } from "@/components/ui/status";
import {
  ServerCard,
  ServerCardHeader,
  ServerCardMeter,
  ServerCardSpec,
  ServerCardSpecs,
  ServerCardStatus,
  ServerCardTitle,
} from "@/components/ui/server-card";

type T = (k: Key) => string;

export function locationOf(s: ServerResult) {
  return [s.country, s.city && s.city !== "?" ? s.city : "", s.provider && s.provider !== "?" ? s.provider : ""].filter(Boolean).join(" · ");
}

export function verdictLabel(v: ServerResult["verdict"], t: T) {
  return v === "good" ? t("good") : v === "ok" ? t("ok") : v === "bad" ? t("bad") : t("noReply");
}

interface Props {
  s: ServerResult;
  t: T;
  first?: boolean;
  delay?: number;
  blocked: boolean;
  /** the game this scan belongs to; enables the "only while it runs" option */
  game?: string;
  /** target = the IP, or a range like 34.165.0.0/16; whilePlaying = switched on only while the game runs */
  onBlock: (target: string, whilePlaying: boolean) => Promise<void>;
  onUnblock: () => Promise<void>;
  /** the match server of a scan: wider, with the wire drawn between you and the server */
  hero?: boolean;
  /** my internet provider (shown under "you" on the wire) */
  isp?: string;
}

const verdictSentence = (v: ServerResult["verdict"]): Key => (v === "good" ? "verdictGood" : v === "ok" ? "verdictOk" : v === "bad" ? "verdictBad" : "verdictNoReply");

export function ResultCard({ s, t, first, delay = 0, blocked, game, onBlock, onUnblock, hero, isp }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [whilePlaying, setWhilePlaying] = useState(true);
  const wp = !!game && whilePlaying;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 12000);
    return () => clearTimeout(id);
  }, [confirm]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <ServerCard highlight={first} className={cn("enter lift relative transition-colors hover:border-primary/40", first && hero && "beam", hero && "gap-5 p-6 md:col-span-2 2xl:col-span-3")} style={{ animationDelay: `${delay}ms` }}>
      <ServerCardHeader>
        <ServerCardTitle
          region={<span className="inline-flex items-center gap-1.5"><Flag country={s.country} cc={s.cc} />{locationOf(s)}</span>}
        >
          {s.ip}
        </ServerCardTitle>
        <ServerCardStatus status={s.verdict}>{verdictLabel(s.verdict, t)}</ServerCardStatus>
      </ServerCardHeader>

      {hero && (
        <>
          <LinkStrip
            avg={s.avg}
            jitter={s.jitter}
            loss={s.loss}
            verdict={s.verdict}
            approx={!!s.via}
            youLabel={t("you")}
            youNote={isp}
            server={<Flag country={s.country} cc={s.cc} />}
            serverNote={s.city && s.city !== "?" ? s.city : s.country}
            className="py-2"
          />
          <p className="mx-auto max-w-xl text-center text-base leading-relaxed font-medium text-pretty">{t(verdictSentence(s.verdict))}</p>
        </>
      )}

      {(first || blocked) && (
        <div className={cn("flex flex-wrap gap-2", hero && "justify-center")}>
          {first && <Status variant="success">{t("matchServer")}</Status>}
          {blocked && <Status variant="error">{t("blocked")}</Status>}
        </div>
      )}

      {!hero && (
        <ServerCardSpecs>
          {!s.tcp && <ServerCardSpec label={t("packets")}>{s.packets}</ServerCardSpec>}
          <ServerCardSpec label={t("port")}>{s.port}</ServerCardSpec>
          {!s.tcp && <ServerCardSpec label="KB">{s.kb}</ServerCardSpec>}
        </ServerCardSpecs>
      )}

      {s.avg == null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t("noReplyHint")}</p>
      ) : (
        <div className={cn("grid gap-3", hero && "sm:grid-cols-3 sm:gap-6")}>
          <ServerCardMeter label={t("ping")} value={s.avg} display={`${s.avg} ms`} unit=" ms" max={200} thresholds={[60, 100]} />
          <ServerCardMeter label={t("jitter")} value={s.jitter ?? 0} display={`${s.jitter ?? 0} ms`} unit=" ms" max={40} thresholds={[8, 15]} />
          <ServerCardMeter label={t("loss")} value={s.loss} display={`${s.loss}%`} unit="%" max={10} thresholds={[1, 3]} />
          {s.via && (
            <p className={cn("text-[11px] leading-relaxed text-muted-foreground", hero && "sm:col-span-3")}>
              {t("viaNote")} <span className="num">{s.via.replace(":", " · ")}</span>
            </p>
          )}
        </div>
      )}

      {hero && (
        <p className="num text-center text-xs text-muted-foreground">
          {s.tcp ? `${t("port")} ${s.port} · TCP` : `${s.packets} ${t("packets")} · ${t("port")} ${s.port} · ${s.kb} KB`}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {s.tcp && !blocked ? (
          <p className="text-[11px] text-muted-foreground">{t("tcpNote")}</p>
        ) : isV6(s.ip) && !blocked ? (
          <p className="text-[11px] text-muted-foreground">{t("v6Note")}</p>
        ) : blocked ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => onUnblock())}>
            {busy ? <LoaderCircle className="animate-spin" /> : <ShieldOff />}
            {busy ? t("blocking") : t("unblock")}
          </Button>
        ) : confirm ? (
          <>
            {game && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-muted p-2.5 text-xs">
                <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={whilePlaying} onChange={(e) => setWhilePlaying(e.target.checked)} />
                <span>
                  <span className="font-medium">{t("whilePlaying")} {game}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{t("whilePlayingHint")}</span>
                </span>
              </label>
            )}
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => run(() => onBlock(rangeOf(s.ip), wp))}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Ban />}
              {busy ? t("blocking") : <>{t("blockRange")} <span className="num">{rangeOf(s.ip)}</span></>}
            </Button>
            <p className="text-[11px] text-success">{t("blockRangeHint")}</p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => onBlock(s.ip, wp))}>
              {t("blockOnlyIp")}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("blockRangeNote")} {t("blockNote")}</p>
          </>        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <Ban /> {t("block")}
          </Button>
        )}
      </div>
    </ServerCard>
  );
}
