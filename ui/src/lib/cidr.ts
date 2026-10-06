// Tiny IPv4 helpers for block rules: a rule is either "a.b.c.d" or "a.b.c.d/len".
export function ipToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function covers(rule: string, ip: string): boolean {
  const [base, len] = rule.split("/");
  if (len === undefined) return base === ip;
  const n = Number(len);
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return ((ipToInt(base) & mask) >>> 0) === ((ipToInt(ip) & mask) >>> 0);
}

/** the /16 range an address belongs to, e.g. 34.165.81.47 -> 34.165.0.0/16 */
export function rangeOf(ip: string): string {
  const p = ip.split(".");
  return `${p[0]}.${p[1]}.0.0/16`;
}
