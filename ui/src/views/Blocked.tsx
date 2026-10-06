import { useState } from "react";
import { Ban, LoaderCircle, ShieldOff } from "lucide-react";
import type { BlockEntry } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  blocks: BlockEntry[];
  onUnblock: (ip: string) => Promise<void>;
  onUnblockAll: () => Promise<void>;
}

export function BlockedView({ t, blocks, onUnblock, onUnblockAll }: Props) {
  const [busy, setBusy] = useState("");

  const one = async (ip: string) => {
    setBusy(ip);
    try { await onUnblock(ip); } finally { setBusy(""); }
  };
  const all = async () => {
    setBusy("*");
    try { await onUnblockAll(); } finally { setBusy(""); }
  };

  if (blocks.length === 0) {
    return (
      <div className="enter flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><Ban className="size-6" /></div>
        <div>
          <div className="text-sm font-medium">{t("blockedEmpty")}</div>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("blockedEmptyText")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("blockedTitle")} <span className="num text-sm font-normal text-muted-foreground">({blocks.length})</span></h2>
        {blocks.length > 1 && (
          <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={all}>
            {busy === "*" ? <LoaderCircle className="animate-spin" /> : <ShieldOff />} {t("unblockAll")}
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {blocks.map((b, i) => (
          <div key={b.ip} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
            <div className="min-w-0">
              <div className="num text-sm font-medium">{b.ip}</div>
              <div className="text-xs break-words text-muted-foreground">
                {b.label}{b.game ? ` · ${b.game}` : ""} · {t("since")} <span className="num">{b.time}</span>
              </div>
            </div>
            <Button variant="secondary" size="sm" disabled={busy !== ""} onClick={() => one(b.ip)}>
              {busy === b.ip ? <LoaderCircle className="animate-spin" /> : <ShieldOff />} {busy === b.ip ? t("blocking") : t("unblock")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
