import { useEffect, useState } from "react";
import { api, type Person, type RunSummary } from "@/api";
import type { Key } from "@/i18n";
import { Flag } from "@/lib/flags";
import { rangeStats } from "@/lib/stats";
import { Skeleton } from "@/components/ui/skeleton";

type T = (k: Key) => string;

interface Row {
  key: string;
  name: string;
  isMe: boolean;
  rows: RunSummary[];
}

interface Props {
  t: T;
  game: string;
  meName: string;
  people: Person[];
  /** changes whenever my own history changes, to reload */
  reloadKey: number;
}

const tone = (avg: number | null) => (avg == null ? "text-muted-foreground" : avg >= 100 ? "text-destructive" : avg >= 60 ? "text-warning" : "text-success");

/** You and the friends whose files you imported, side by side for one game. Every person's data stays in their own folder. */
export function CompareCard({ t, game, meName, people, reloadKey }: Props) {
  const [data, setData] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const mine = await api.history(game, "").catch(() => [] as RunSummary[]);
      const others = await Promise.all(
        people.map(async (p) => ({ key: p.slug, name: p.name, isMe: false, rows: await api.history(game, p.slug).catch(() => [] as RunSummary[]) })),
      );
      if (alive) setData([{ key: "me", name: meName, isMe: true, rows: mine }, ...others]);
    })();
    return () => { alive = false; };
  }, [game, meName, people, reloadKey]);

  if (people.length === 0) return null;

  return (
    <section className="enter lift rounded-2xl border border-border bg-card p-5">
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">{t("compareTitle")} · {game}</h3>
      {data === null ? (
        <div className="grid gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{t("colPlayer")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colMatches")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colAvg")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colTop")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("ispLabel")}</th>
                <th className="py-2 ps-3 text-start font-medium">{t("colBad")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const pings = d.rows.map((r) => r.best?.avg).filter((v): v is number => v != null);
                const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
                const top = rangeStats(d.rows)[0];
                const bad = d.rows.filter((r) => r.best?.verdict === "bad").length;
                return (
                  <tr key={d.key} className="border-t border-border">
                    <td className="py-2.5 pe-3 font-medium">{d.name}{d.isMe && <span className="ms-2 text-xs font-normal text-muted-foreground">({t("me")})</span>}</td>
                    {d.rows.length === 0 ? (
                      <td colSpan={5} className="px-3 py-2.5 text-xs text-muted-foreground">{t("noDataGame")}</td>
                    ) : (
                      <>
                        <td className="num px-3 py-2.5">{d.rows.length}</td>
                        <td className={`num px-3 py-2.5 font-medium ${tone(avg)}`}>{avg != null ? `${avg} ms` : "—"}</td>
                        <td className="px-3 py-2.5">
                          {top && (
                            <span className="inline-flex items-center gap-2">
                              <Flag country={top.sample.country} cc={top.sample.cc} />
                              <span>{[top.sample.country, top.sample.city && top.sample.city !== "?" ? top.sample.city : ""].filter(Boolean).join(" · ")}</span>
                              <span className="num text-xs text-muted-foreground">{Math.round(top.share * 100)}%</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.rows.find((r) => r.net?.isp)?.net?.isp ?? "—"}</td>
                        <td className="num py-2.5 ps-3">{bad}/{d.rows.length}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
