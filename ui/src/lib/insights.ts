// Pools everyone's scans of ONE game (mine + the friends imported) and finds the address ranges that keep giving bad
// servers, plus the range the matches land on when things go well. Nothing leaves this PC: it only reads the local history.
import type { RunSummary, ServerResult } from "@/api";
import { isV6, rangeKey } from "@/lib/stats";

/** one person's scans of the game (mine, or an imported friend's) */
export interface Source {
  name: string;
  isMe: boolean;
  rows: RunSummary[];
}

export interface PlayerSlice {
  name: string;
  isMe: boolean;
  matches: number;
  bad: number;
  avg: number | null;
}

export interface RangeInsight {
  range: string;
  sample: ServerResult;
  matches: number;
  bad: number;
  avg: number | null;
  players: PlayerSlice[];
}

export interface GameInsight {
  game: string;
  totalMatches: number;
  playerCount: number;
  /** at most two: the ranges worth blocking */
  suggestions: RangeInsight[];
  /** where matches usually land when they are fine (what you would most likely get after a block) */
  alternative: RangeInsight | null;
  /** ranges that are bad for other players but fine for you */
  mixed: RangeInsight[];
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function aggregate(sources: Source[]): RangeInsight[] {
  const map = new Map<string, { sample: ServerResult; pings: number[]; matches: number; bad: number; per: Map<string, { s: Source; n: number; bad: number; pings: number[] }> }>();
  for (const src of sources) {
    for (const r of src.rows) {
      const b = r.best;
      if (!b) continue;
      const key = rangeKey(b.ip);
      const e = map.get(key) ?? { sample: b, pings: [] as number[], matches: 0, bad: 0, per: new Map<string, { s: Source; n: number; bad: number; pings: number[] }>() };
      e.matches++;
      if (b.verdict === "bad") e.bad++;
      if (b.avg != null) e.pings.push(b.avg);
      const p = e.per.get(src.name) ?? { s: src, n: 0, bad: 0, pings: [] as number[] };
      p.n++;
      if (b.verdict === "bad") p.bad++;
      if (b.avg != null) p.pings.push(b.avg);
      e.per.set(src.name, p);
      map.set(key, e);
    }
  }
  return [...map.entries()].map(([range, e]) => ({
    range,
    sample: e.sample,
    matches: e.matches,
    bad: e.bad,
    avg: mean(e.pings),
    players: [...e.per.values()]
      .map((p) => ({ name: p.s.name, isMe: p.s.isMe, matches: p.n, bad: p.bad, avg: mean(p.pings) }))
      .sort((a, b) => b.matches - a.matches),
  }));
}

/**
 * Rules (kept simple on purpose, so the numbers shown beside a suggestion explain it):
 * - suggest a range that was rated bad in at least 2 matches and in at least 60% of the matches that landed on it
 * - never suggest what is fine for you: if you have 2+ matches there and at most 20% are bad, skip it (it is bad for others only)
 * - IPv6 and already blocked ranges are skipped; best two first: more players affected, then more bad matches, then higher ping
 */
export function buildInsight(game: string, sources: Source[], isBlocked: (ip: string) => boolean): GameInsight {
  const all = aggregate(sources);
  const totalMatches = all.reduce((a, r) => a + r.matches, 0);
  const playerCount = sources.filter((s) => s.rows.some((r) => r.best)).length;

  const fineForMe = (r: RangeInsight) => {
    const me = r.players.find((p) => p.isMe);
    return !!me && me.matches >= 2 && me.bad / me.matches <= 0.2;
  };

  const suggestions = all
    .filter((r) => !isV6(r.range) && r.bad >= 2 && r.bad / r.matches >= 0.6 && !fineForMe(r) && !isBlocked(r.sample.ip))
    .sort((a, b) => b.players.filter((p) => p.bad > 0).length - a.players.filter((p) => p.bad > 0).length || b.bad - a.bad || (b.avg ?? 0) - (a.avg ?? 0))
    .slice(0, 2);

  const alternative =
    all
      .filter((r) => r.avg != null && r.avg < 60 && r.bad / r.matches <= 0.2 && r.matches >= 2 && !suggestions.includes(r))
      .sort((a, b) => b.matches - a.matches)[0] ?? null;

  // bad for others but fine for you: not suggested, but said out loud so the missing suggestion is explained
  const mixed = all.filter((r) => !isV6(r.range) && r.bad >= 2 && r.bad / r.matches >= 0.6 && fineForMe(r));

  return { game, totalMatches, playerCount, suggestions, alternative, mixed };
}
