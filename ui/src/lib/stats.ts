import type { RunSummary, ServerResult } from "@/api";
import { rangeOf } from "@/lib/cidr";

export const isV6 = (ip: string) => ip.includes(":");

/** the block unit of an address: its /16 for IPv4 (servers change address inside it), the address itself for IPv6 */
export const rangeKey = (ip: string) => (isV6(ip) ? ip : rangeOf(ip));

export interface RangeStat {
  range: string;
  count: number;
  /** share of all scans, 0..1 */
  share: number;
  /** mean of the measured pings (null if none answered) */
  avg: number | null;
  /** scans where this range's server was rated "bad" */
  bad: number;
  /** newest server seen in this range (used for the flag / location label) */
  sample: ServerResult;
}

/** Groups the match server of every scan (the busiest one) by address range. rows are newest first. */
export function rangeStats(rows: RunSummary[]): RangeStat[] {
  const total = rows.filter((r) => r.best).length;
  const map = new Map<string, { sum: number; n: number; count: number; bad: number; sample: ServerResult }>();
  for (const r of rows) {
    const b = r.best;
    if (!b) continue;
    const key = rangeKey(b.ip);
    const e = map.get(key) ?? { sum: 0, n: 0, count: 0, bad: 0, sample: b };
    e.count++;
    if (b.avg != null) { e.sum += b.avg; e.n++; }
    if (b.verdict === "bad") e.bad++;
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([range, e]) => ({
      range, count: e.count, share: total ? e.count / total : 0,
      avg: e.n ? Math.round(e.sum / e.n) : null, bad: e.bad, sample: e.sample,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Ranges that keep giving a bad server and are not blocked yet (IPv4 only: only those can be blocked). */
export function suggestions(stats: RangeStat[], isBlocked: (ip: string) => boolean): RangeStat[] {
  return stats.filter((s) => !isV6(s.range) && s.bad >= 2 && s.bad / s.count >= 0.6 && !isBlocked(s.sample.ip));
}
