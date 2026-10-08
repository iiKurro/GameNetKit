// Places for the globe: the land mask, a centre point per country, and country names <-> codes.
import { CENTRES, LAND_B64, LAND_H, LAND_W } from "@/assets/geo";

let bits: Uint8Array | null = null;

function mask(): Uint8Array {
  if (bits) return bits;
  const bin = atob(LAND_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  bits = out;
  return out;
}

/** is there land at this latitude / longitude (degrees)? one cell is one degree */
export function isLand(lat: number, lon: number): boolean {
  const r = Math.min(LAND_H - 1, Math.max(0, Math.floor(90 - lat)));
  const c = Math.min(LAND_W - 1, Math.max(0, Math.floor(lon + 180)));
  const i = r * LAND_W + c;
  return (mask()[i >> 3] & (1 << (i & 7))) !== 0;
}

/** the code the app shows for a place: the old code of a scan saved earlier is written the same way as a new one */
export function normalCode(cc?: string): string {
  const c = (cc ?? "").toUpperCase();
  return c === "IL" ? "PS" : c;
}

export function centreOf(cc?: string): [number, number] | null {
  return CENTRES[normalCode(cc)] ?? null;
}

/** the exact place when the scan has one, otherwise the middle of the country */
export function placeOf(p: { lat?: number | null; lon?: number | null; cc?: string }): [number, number] | null {
  if (typeof p.lat === "number" && typeof p.lon === "number" && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) return [p.lat, p.lon];
  return centreOf(p.cc);
}

let byName: Map<string, string> | null = null;

/** "Saudi Arabia" -> "SA" (saved scans of an older version only have the name of the country) */
export function codeOfName(name?: string): string {
  if (!name) return "";
  if (!byName) {
    byName = new Map();
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      for (const code of Object.keys(CENTRES)) { const n = dn.of(code); if (n) byName.set(n.toLowerCase(), code); }
    } catch { /* an old engine: no names, the globe then has no starting point from a name */ }
  }
  return normalCode(byName.get(name.toLowerCase()) ?? "");
}

/** the country as written in the language of the page; the place the app calls Palestine is always called that */
export function countryName(cc: string, lang: string): string {
  const c = normalCode(cc);
  if (c === "PS") return lang === "ar" ? "فلسطين" : "Palestine";
  try { return new Intl.DisplayNames([lang], { type: "region" }).of(c) ?? c; } catch { return c; }
}

/** where the player most likely is, when no scan says so: the region of the browser's language ("ar-SA" -> SA) */
export function guessHome(): string {
  try {
    const m = /-([A-Za-z]{2})\b/.exec(navigator.language);
    const c = m ? normalCode(m[1]) : "";
    return c && CENTRES[c] ? c : "";
  } catch { return ""; }
}
