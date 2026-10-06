import { useEffect, useState } from "react";
import { Ban, LoaderCircle, Plus, RefreshCw, ShieldOff } from "lucide-react";
import type { BlockEntry } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

type T = (k: Key) => string;

interface Props {
  t: T;
  blocks: BlockEntry[];
  onUnblock: (target: string) => Promise<void>;
  onUnblockAll: () => Promise<void>;
  onAdd: (target: string) => Promise<void>;
  onSync: () => Promise<void>;
}

// public IPv4 address, or a range from /16 to /32 (the server validates again)
const TARGET = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:1[6-9]|2\d|3[0-2]))?$/;

export function BlockedView({ t, blocks, onUnblock, onUnblockAll, onAdd, onSync }: Props) {
  const [busy, setBusy] = useState("");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  // the list always reflects the real firewall rules when this tab opens
  useEffect(() => { void onSync(); }, [onSync]);

  const work = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  };

  const add = async () => {
    const v = text.trim();
    if (!TARGET.test(v)) { setInvalid(true); return; }
    setInvalid(false);
    await work("add", async () => { await onAdd(v); setText(""); });
  };

  // group rules by the game they were made for (rules found in the firewall without a game go to "manual")
  const groups = new Map<string, BlockEntry[]>();
  for (const b of blocks) {
    const k = b.game || "";
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }

  return (
    <div className="flex flex-col gap-4">
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
          <Button size="md" disabled={busy !== "" || text.trim() === ""} onClick={add}>
            {busy === "add" ? <LoaderCircle className="animate-spin" /> : <Plus />} {t("manualBlock")}
          </Button>
        </div>
        {invalid && <p className="mt-2 text-xs text-destructive">{t("manualInvalid")}</p>}
      </div>

      {blocks.length === 0 ? (
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
              {list.map((b, i) => (
                <div key={b.ip} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-sm font-medium">{b.ip}</span>
                      {b.method === "route" && <Status variant="info" title={t("viaRouteHint")}>{t("viaRoute")}</Status>}
                    </div>
                    <div className="text-xs break-words text-muted-foreground">
                      {b.label}{b.label && b.time ? " · " : ""}{b.time && <>{t("since")} <span className="num">{b.time}</span></>}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" disabled={busy !== ""} onClick={() => work(b.ip, () => onUnblock(b.ip))}>
                    {busy === b.ip ? <LoaderCircle className="animate-spin" /> : <ShieldOff />} {busy === b.ip ? t("blocking") : t("unblock")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">{t("removeNote")}</p>
    </div>
  );
}
