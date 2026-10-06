import { useEffect, useState } from "react";
import { Ban, LoaderCircle, ShieldOff } from "lucide-react";
import type { ServerResult } from "@/api";
import type { Key } from "@/i18n";
import { rangeOf } from "@/lib/cidr";
import { Flag } from "@/lib/flags";
import { isV6 } from "@/lib/stats";
import { Button } from "@/components/ui/button";
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
}

export function ResultCard({ s, t, first, delay = 0, blocked, game, onBlock, onUnblock }: Props) {
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
    <ServerCard highlight={first} className="enter" style={{ animationDelay: `${delay}ms` }}>
      <ServerCardHeader>
        <ServerCardTitle
          region={<span className="inline-flex items-center gap-1.5"><Flag country={s.country} cc={s.cc} />{locationOf(s)}</span>}
        >
          {s.ip}
        </ServerCardTitle>
        <ServerCardStatus status={s.verdict}>{verdictLabel(s.verdict, t)}</ServerCardStatus>
      </ServerCardHeader>

      {(first || blocked) && (
        <div className="flex flex-wrap gap-2">
          {first && <Status variant="success">{t("matchServer")}</Status>}
          {blocked && <Status variant="error">{t("blocked")}</Status>}
        </div>
      )}

      <ServerCardSpecs>
        <ServerCardSpec label={t("packets")}>{s.packets}</ServerCardSpec>
        <ServerCardSpec label={t("port")}>{s.port}</ServerCardSpec>
        <ServerCardSpec label="KB">{s.kb}</ServerCardSpec>
      </ServerCardSpecs>

      {s.avg == null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t("noReplyHint")}</p>
      ) : (
        <div className="grid gap-3">
          <ServerCardMeter label={t("ping")} value={s.avg} display={`${s.avg} ms`} max={200} thresholds={[60, 100]} />
          <ServerCardMeter label={t("jitter")} value={s.jitter ?? 0} display={`${s.jitter ?? 0} ms`} max={40} thresholds={[8, 15]} />
          <ServerCardMeter label={t("loss")} value={s.loss} display={`${s.loss}%`} max={10} thresholds={[1, 3]} />
          {s.via && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("viaNote")} <span className="num">{s.via.replace(":", " · ")}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {isV6(s.ip) && !blocked ? (
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
