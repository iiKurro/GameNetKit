import type { Run, ServerResult } from "@/api";
import type { Key } from "@/i18n";

type T = (k: Key) => string;

const place = (s: ServerResult) => [s.country, s.city && s.city !== "?" ? s.city : ""].filter(Boolean).join(" · ");

/** the text a player sends to a friend: the match server first, then the other servers seen in the same scan */
export function summaryText(run: Pick<Run, "game" | "time" | "results"> & { net?: { isp?: string } | null }, t: T, name: string): string {
  const lines: string[] = [];
  lines.push(`GameNetKit · ${run.game}${run.time ? " · " + run.time : ""}${name ? " · " + name : ""}`);
  if (run.net?.isp) lines.push(`${t("ispLabel")}: ${run.net.isp}`);
  run.results.slice(0, 5).forEach((s, i) => {
    const head = i === 0 ? t("matchServer") : t("server");
    const q = s.avg == null ? t("noReply") : `${s.avg} ms · ${t("jitter")} ${s.jitter ?? 0} · ${t("loss")} ${s.loss}%`;
    lines.push(`${i === 0 ? "▶ " : "• "}${head}: ${place(s)} (${s.ip}) · ${q}${s.via ? " ≈" : ""}`);
  });
  return lines.join("\n");
}

/** clipboard with a fallback for windows where the async API is refused */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
