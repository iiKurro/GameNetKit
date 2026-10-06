import { useState } from "react";
import { Ban, Lightbulb, LoaderCircle, X } from "lucide-react";
import type { ServerResult } from "@/api";
import type { Key } from "@/i18n";
import type { RangeStat } from "@/lib/stats";
import { Flag } from "@/lib/flags";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  items: RangeStat[];
  onBlock: (s: ServerResult, target: string) => Promise<void>;
}

/** "This range keeps giving you a bad server - block it?" Nothing is blocked without a click (and the admin prompt). */
export function Suggestions({ t, items, onBlock }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const shown = items.filter((s) => !dismissed.has(s.range));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {shown.map((s) => (
        <div key={s.range} className="enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t("suggestTitle")}
                <Flag country={s.sample.country} cc={s.sample.cc} />
                <span className="num">{s.range}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("suggestText").replace("%n", String(s.count)).replace("%b", String(s.bad)).replace("%avg", s.avg != null ? String(s.avg) : "—")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== ""}
              onClick={async () => { setBusy(s.range); try { await onBlock(s.sample, s.range); } finally { setBusy(""); } }}
            >
              {busy === s.range ? <LoaderCircle className="animate-spin" /> : <Ban />} {t("suggestBlock")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(new Set([...dismissed, s.range]))} aria-label={t("suggestLater")}>
              <X /> {t("suggestLater")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
