import type { RunSummary } from "@/api";
import type { Key } from "@/i18n";

type T = (k: Key) => string;

const COLOR = { good: "var(--color-success)", ok: "var(--color-warning)", bad: "var(--color-destructive)", noreply: "var(--color-muted-foreground)" };

/** Ping of the match server across scans, oldest to newest. The dashed lines are the 60 / 100 ms rating limits. */
export function PingChart({ rows, t }: { rows: RunSummary[]; t: T }) {
  const pts = [...rows].reverse().filter((r) => r.best && r.best.avg != null);
  if (pts.length < 2) return null;

  const W = 640, H = 150, L = 36, R = 12, T0 = 12, B = 24;
  const max = Math.max(160, ...pts.map((r) => r.best!.avg as number)) * 1.08;
  const x = (i: number) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v: number) => T0 + (1 - v / max) * (H - T0 - B);
  const line = pts.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.best!.avg as number).toFixed(1)}`).join(" ");

  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{t("chartTitle")}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("chartTitle")} style={{ direction: "ltr" }}>
        {[0, 60, 100, 150].filter((v) => v <= max).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeDasharray={v === 60 || v === 100 ? "4 4" : undefined} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--color-muted-foreground)">{v}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--color-muted-foreground)" strokeOpacity=".45" strokeWidth="1.5" />
        {pts.map((r, i) => (
          <circle key={r.id} cx={x(i)} cy={y(r.best!.avg as number)} r="4.5" fill={COLOR[r.best!.verdict]} stroke="var(--color-card)" strokeWidth="1.5">
            <title>{`${r.time} · ${r.best!.ip} · ${r.best!.avg} ms`}</title>
          </circle>
        ))}
        <text x={x(0)} y={H - 6} textAnchor="start" fontSize="10" fill="var(--color-muted-foreground)">{pts[0].time.slice(5, 16)}</text>
        <text x={x(pts.length - 1)} y={H - 6} textAnchor="end" fontSize="10" fill="var(--color-muted-foreground)">{pts[pts.length - 1].time.slice(5, 16)}</text>
      </svg>
    </figure>
  );
}
