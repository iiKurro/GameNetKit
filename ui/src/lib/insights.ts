// Pools everyone's scans of ONE game (mine + the friends of the group) and finds the address ranges that keep giving bad
// servers, plus the range the matches land on when things go well. It only reads the local history files.
import type { RunSummary, ServerResult } from "@/api";
import { covers } from "@/lib/cidr";
import { isV6, rangeKey } from "@/lib/stats";

/** one person's scans of the game (mine, or a friend's). key = what tells people apart (never the display name) */
export interface Source {
  key: string;
  name: string;
  isMe: boolean;
  rows: RunSummary[];
}

export interface PlayerSlice {
  key: string;
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
  /** the scans that landed here were located in more than one country: the range is shared by different places */
  multiCountry: boolean;
}

export interface GameInsight {
  game: string;
  totalMatches: number;
  playerCount: number;
  /** at most two: the ranges worth blocking */
  suggestions: RangeInsight[];
  /** where MY matches usually land when they are fine (what you would most likely get after a block) */
  alternative: RangeInsight | null;
  /** ranges that are bad for others but have not been bad for me */
  mixed: RangeInsight[];
  /** ranges that were bad for friends but I have never landed on: worth knowing, not enough to block */
  headsUp: RangeInsight[];
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** scans older than this are ignored: servers and routes change, an old bad streak should not trigger a block today */
const MAX_AGE_DAYS = 60;

function recent(time: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(time || "");
  if (!m) return true;   // unknown date: keep it
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Date.now() - t <= MAX_AGE_DAYS * 86400000;
}

interface Acc {
  sample: ServerResult;
  pings: number[];
  matches: number;
  bad: number;
  countries: Set<string>;
  per: Map<string, { s: Source; n: number; bad: number; pings: number[] }>;
}

export function aggregate(sources: Source[]): RangeInsight[] {
  const map = new Map<string, Acc>();
  for (const src of sources) {
    for (const r of src.rows) {
      const b = r.best;
      if (!b || !recent(r.time)) continue;
      const key = rangeKey(b.ip);
      let e = map.get(key);
      if (!e) { e = { sample: b, pings: [], matches: 0, bad: 0, countries: new Set<string>(), per: new Map() }; map.set(key, e); }
      e.matches++;
      const label = (b.cc || b.country || "").trim();
      if (label && label !== "?") e.countries.add(label.toUpperCase());
      if (b.verdict === "bad") e.bad++;
      if (b.avg != null) e.pings.push(b.avg);
      let p = e.per.get(src.key);
      if (!p) { p = { s: src, n: 0, bad: 0, pings: [] }; e.per.set(src.key, p); }
      p.n++;
      if (b.verdict === "bad") p.bad++;
      if (b.avg != null) p.pings.push(b.avg);
    }
  }
  return [...map.entries()].map(([range, e]) => ({
    range,
    sample: e.sample,
    matches: e.matches,
    bad: e.bad,
    avg: mean(e.pings),
    multiCountry: e.countries.size > 1,
    players: [...e.per.values()]
      .map((p) => ({ key: p.s.key, name: p.s.name, isMe: p.s.isMe, matches: p.n, bad: p.bad, avg: mean(p.pings) }))
      .sort((a, b) => b.matches - a.matches),
  }));
}

const mine = (r: RangeInsight) => r.players.find((p) => p.isMe);

/** the whole /16 is already covered by a block rule (a rule for one address inside it does not count) */
export function rangeBlocked(range: string, blockedRules: string[]): boolean {
  const base = range.split("/")[0];
  return blockedRules.some((rule) => {
    const len = Number(rule.split("/")[1] ?? 32);
    return len <= 16 && covers(rule, base);
  });
}

/**
 * Rules (kept simple on purpose, so the numbers shown beside a suggestion explain it):
 * - only scans of the last 60 days count
 * - a range is "bad" when at least 2 matches there were rated bad and at least 60% of the matches that landed on it
 * - it is SUGGESTED only if I have had a bad match on it myself (a ping is measured from each player's own place, so a range
 *   that is bad for a friend far away says little about my connection) and it is not fine for me (2+ matches, at most 20% bad)
 * - a range that is bad for friends but I never landed on is only mentioned ("heads-up"); one that was fine for me is "mixed"
 * - ranges that spanned several countries, IPv6 and ranges already blocked are never suggested
 * - the "after blocking" alternative comes from MY matches only, because only my ping numbers describe my connection
 */
export function buildInsight(game: string, sources: Source[], blockedRules: string[]): GameInsight {
  const all = aggregate(sources);
  const totalMatches = all.reduce((a, r) => a + r.matches, 0);
  const playerCount = sources.filter((s) => s.rows.some((r) => r.best && recent(r.time))).length;
  const blocked = (r: RangeInsight) => rangeBlocked(r.range, blockedRules);

  const poolBad = (r: RangeInsight) => !isV6(r.range) && !r.multiCountry && r.bad >= 2 && r.bad / r.matches >= 0.6 && !blocked(r);
  const fineForMe = (r: RangeInsight) => {
    const me = mine(r);
    return !!me && me.matches >= 2 && me.bad / me.matches <= 0.2;
  };

  const suggestions = all
    .filter((r) => poolBad(r) && (mine(r)?.bad ?? 0) >= 1 && !fineForMe(r))
    .sort((a, b) => b.players.filter((p) => p.bad > 0).length - a.players.filter((p) => p.bad > 0).length || b.bad - a.bad || (b.avg ?? 0) - (a.avg ?? 0))
    .slice(0, 2);

  const mixed = all.filter((r) => poolBad(r) && (mine(r)?.matches ?? 0) > 0 && (mine(r)?.bad ?? 0) === 0);
  const headsUp = all.filter((r) => poolBad(r) && !mine(r)).sort((a, b) => b.bad - a.bad).slice(0, 2);

  const alternative =
    all
      .map((r) => ({ r, me: mine(r) }))
      .filter((x) => x.me && x.me.avg != null && x.me.avg < 60 && x.me.bad / x.me.matches <= 0.2 && x.me.matches >= 2)
      .filter((x) => !isV6(x.r.range) && !x.r.multiCountry && !blocked(x.r) && !suggestions.includes(x.r))
      .sort((a, b) => b.me!.matches - a.me!.matches)
      .map((x) => ({ ...x.r, matches: x.me!.matches, bad: x.me!.bad, avg: x.me!.avg }))[0] ?? null;

  return { game, totalMatches, playerCount, suggestions, alternative, mixed, headsUp };
}
