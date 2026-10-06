import { useState } from "react";
import { Ban, CheckCircle2, Eye, Gamepad2, Lightbulb, LoaderCircle, RefreshCw, TriangleAlert, Users } from "lucide-react";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Flag } from "@/lib/flags";
import type { GameInsight, RangeInsight } from "@/lib/insights";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServerResult } from "@/api";

type T = (k: Key) => string;

interface Props {
  t: T;
  /** null while the history of every player is still loading */
  insights: GameInsight[] | null;
  /** some scans could not be loaded (the app retries by itself) */
  failed: boolean;
  onRetry: () => void;
  peopleCount: number;
  /** the app has a group server (otherwise the "invite friends" hint makes no sense) */
  sharing: boolean;
  onBlock: (s: ServerResult, game: string, range: string) => Promise<void>;
}

const where = (r: RangeInsight) =>
  [r.sample.country, r.sample.city && r.sample.city !== "?" ? r.sample.city : ""].filter(Boolean).join(" · ");

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/%(\w+)/g, (_, k) => String(vars[k] ?? ""));

/** One or two block suggestions per game, built from everybody's scans, with the numbers that justify them. */
export function InsightsView({ t, insights, failed, onRetry, peopleCount, sharing, onBlock }: Props) {
  const [busy, setBusy] = useState("");

  if (insights === null) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  const withData = insights.filter((g) => g.totalMatches > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{t("insightsTitle")}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{t("insightsIntro")}</p>
      </div>

      {failed && (
        <div role="alert" className="enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /> {t("insightsLoadFail")}</p>
          <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw /> {t("retry")}</Button>
        </div>
      )}

      {sharing && peopleCount === 0 && (
        <div className="enter flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4">
          <Users className="mt-0.5 size-4 shrink-0 text-info" />
          <p className="text-sm">{t("insightsInvite")}</p>
        </div>
      )}

      {withData.length === 0 && (
        <div className="enter flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground"><Lightbulb className="size-6" /></div>
          <p className="max-w-sm text-sm text-muted-foreground">{t("insightsEmpty")}</p>
        </div>
      )}

      {withData.map((g) => (
        <section key={g.game} className="enter flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Gamepad2 className="size-4 text-primary" /> {g.game}</h3>
            <span className="num text-xs text-muted-foreground">{g.playerCount} {t("insightsPlayers")} · {g.totalMatches} {t("statsMatches")}</span>
          </header>

          {g.suggestions.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              {g.totalMatches < 3 ? t("insightsFew") : t("insightsNone")}
            </p>
          ) : (
            g.suggestions.map((s) => {
              const confident = s.players.filter((p) => p.bad > 0).length >= 2;
              return (
                <article key={s.range} className="flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <Flag country={s.sample.country} cc={s.sample.cc} />
                        <span>{where(s)}</span>
                        <span className="num text-xs text-muted-foreground">{s.range}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fill(t("insightsBadIn"), { b: s.bad, n: s.matches })} · {s.avg != null ? fill(t("insightsAvg"), { avg: s.avg }) : ""}
                      </p>
                    </div>
                    <Status variant={confident ? "success" : "warning"}>{confident ? t("insightsConfHigh") : t("insightsConfLow")}</Status>
                  </div>

                  <ul className="flex flex-wrap gap-2" aria-label={t("insightsSeenBy")}>
                    {s.players.map((p) => (
                      <li key={p.key} className={cn("rounded-md border px-2 py-1 text-xs", p.bad > 0 ? "border-destructive/30 bg-destructive/10" : "border-success/30 bg-success/10")}>
                        <span className="font-medium">{p.name}{p.isMe ? ` (${t("me")})` : ""}</span>
                        <span className="num text-muted-foreground"> · {p.bad}/{p.matches} · {p.avg != null ? `${p.avg} ms` : "—"}</span>
                      </li>
                    ))}
                  </ul>

                  <div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy !== ""}
                      onClick={async () => { setBusy(s.range + g.game); try { await onBlock(s.sample, g.game, s.range); } finally { setBusy(""); } }}
                    >
                      {busy === s.range + g.game ? <LoaderCircle className="animate-spin" /> : <Ban />} {t("insightsBlock")} {g.game}
                    </Button>
                  </div>
                </article>
              );
            })
          )}

          {g.mixed.map((m) => (
            <p key={m.range} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-info" />
              <Flag country={m.sample.country} cc={m.sample.cc} />
              <span className="num">{m.range}</span>
              <span>{t("insightsMixed")}</span>
            </p>
          ))}

          {g.headsUp.map((h) => (
            <p key={h.range} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Eye className="size-4 shrink-0 text-warning" />
              <Flag country={h.sample.country} cc={h.sample.cc} />
              <span className="num">{h.range}</span>
              <span>{t("insightsHeadsUp")} ({fill(t("insightsBadIn"), { b: h.bad, n: h.matches })})</span>
            </p>
          ))}

          {g.suggestions.length > 0 && g.alternative && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <span>{t("insightsAlt")}:</span>
              <Flag country={g.alternative.sample.country} cc={g.alternative.sample.cc} />
              <span className="text-foreground">{where(g.alternative)}</span>
              <span className="num">{fill(t("insightsAltText"), { avg: g.alternative.avg ?? "—", n: g.alternative.matches })}</span>
            </p>
          )}
        </section>
      ))}

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("insightsCaveat")}</p>
    </div>
  );
}
