import { useEffect, useState } from "react";
import { Ban, LoaderCircle, ShieldOff } from "lucide-react";
import type { ServerResult } from "@/api";
import type { Key } from "@/i18n";
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
  onBlock: (s: ServerResult) => Promise<void>;
  onUnblock: (ip: string) => Promise<void>;
}

export function ResultCard({ s, t, first, delay = 0, blocked, onBlock, onUnblock }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(id);
  }, [confirm]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <ServerCard highlight={first} className="enter" style={{ animationDelay: `${delay}ms` }}>
      <ServerCardHeader>
        <ServerCardTitle region={locationOf(s)}>{s.ip}</ServerCardTitle>
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
        <p className="text-xs text-muted-foreground">{t("noReply")}</p>
      ) : (
        <div className="grid gap-3">
          <ServerCardMeter label={t("ping")} value={s.avg} display={`${s.avg} ms`} max={200} thresholds={[60, 100]} />
          <ServerCardMeter label={t("jitter")} value={s.jitter ?? 0} display={`${s.jitter ?? 0} ms`} max={40} thresholds={[8, 15]} />
          <ServerCardMeter label={t("loss")} value={s.loss} display={`${s.loss}%`} max={10} thresholds={[1, 3]} />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {blocked ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => onUnblock(s.ip))}>
            {busy ? <LoaderCircle className="animate-spin" /> : <ShieldOff />}
            {busy ? t("blocking") : t("unblock")}
          </Button>
        ) : confirm ? (
          <>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => run(() => onBlock(s))}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Ban />}
              {busy ? t("blocking") : t("blockConfirm")}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("blockNote")}</p>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <Ban /> {t("block")}
          </Button>
        )}
      </div>
    </ServerCard>
  );
}
