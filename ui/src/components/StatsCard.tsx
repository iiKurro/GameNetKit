import type { RunSummary } from "@/api";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Flag } from "@/lib/flags";
import { rangeStats } from "@/lib/stats";
import { PingChart } from "@/components/PingChart";

type T = (k: Key) => string;

const tone = (avg: number | null) => (avg == null ? "bg-muted-foreground" : avg >= 100 ? "bg-destructive" : avg >= 60 ? "bg-warning" : "bg-success");

/** Where the matches of one game landed: share of scans and mean ping per address range, plus the ping trend. */
export function StatsCard({ rows, t }: { rows: RunSummary[]; t: T }) {
  const stats = rangeStats(rows);
  if (stats.length === 0) return null;
  return (
    <section className="enter grid gap-5 rounded-xl border border-border bg-card p-5 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("statsTitle")}</h3>
        {stats.slice(0, 5).map((s) => (
          <div key={s.range} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Flag country={s.sample.country} cc={s.sample.cc} />
                <span className="truncate">{[s.sample.country, s.sample.city && s.sample.city !== "?" ? s.sample.city : ""].filter(Boolean).join(" · ")}</span>
                <span className="num text-xs text-muted-foreground">{s.range}</span>
              </span>
              <span className="num shrink-0 text-xs text-muted-foreground">
                {s.count} {t("statsMatches")} · {s.avg != null ? `${s.avg} ms` : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" title={`${Math.round(s.share * 100)}%`}>
              <div className={cn("h-full rounded-full transition-[width] duration-500", tone(s.avg))} style={{ width: `${Math.max(4, s.share * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <PingChart rows={rows} t={t} />
    </section>
  );
}
