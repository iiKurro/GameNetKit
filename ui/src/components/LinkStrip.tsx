import { useId, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/lib/useCountUp";

type Verdict = "good" | "ok" | "bad" | "noreply";

const TONE: Record<Verdict, string> = {
  good: "var(--color-success)",
  ok: "var(--color-warning)",
  bad: "var(--color-destructive)",
  noreply: "var(--color-muted-foreground)",
};

interface Props {
  avg: number | null;
  jitter: number | null;
  loss: number;
  verdict: Verdict;
  /** the ping was measured through the server's cloud region, not to the server itself */
  approx?: boolean;
  youLabel: string;
  youNote?: string;
  server: ReactNode;
  serverNote?: ReactNode;
  className?: string;
  /** a calmer, shorter strip for lists */
  compact?: boolean;
}

const N = 7;                                  // packets on the wire
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };   // fixed "randomness": no flicker between renders

/**
 * Your connection to the server as a wire with packets on it, so the three numbers can be felt as well as read:
 *  - the ping sets how long a packet takes to cross,
 *  - jitter makes the spacing between packets uneven (bunching and gaps),
 *  - loss makes packets vanish half way.
 * No reply: the packets fade out immediately, the wire stays dashed.
 */
export function LinkStrip({ avg, jitter, loss, verdict, approx, youLabel, youNote, server, serverNote, className, compact }: Props) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const shown = useCountUp(avg, 1000);
  const tone = TONE[verdict];

  const dur = avg == null ? 3 : Math.min(4.6, Math.max(1.1, 1.0 + avg / 80));      // seconds to cross
  const gap = dur / N;                                                              // even spacing when jitter is 0
  const wobble = Math.min(1.6, (jitter ?? 0) / 10);                                 // 10 ms of jitter = a full gap of unevenness
  const lostCount = avg == null ? N : loss <= 0 ? 0 : Math.min(N - 1, Math.max(1, Math.round((loss / 100) * N * 2)));
  const lostSet = new Set<number>();
  for (let k = 0; k < lostCount; k++) lostSet.add((k * 3 + 2) % N);

  const packets = Array.from({ length: N }, (_, i) => {
    const offset = i * gap + (rnd(i) - 0.5) * gap * wobble * 2;
    return { i, begin: -(((offset % dur) + dur) % dur), lost: lostSet.has(i) };
  });

  const W = 600, Y = 30;
  const path = `M12 ${Y} L${W - 12} ${Y}`;
  const label = avg == null ? "" : `${approx ? "≈ " : ""}${shown} ms`;

  return (
    <div className={cn("flex items-center gap-3 sm:gap-5", className)} style={{ color: tone }}>
      <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center sm:w-24">
        <span className="flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-foreground lift"><Monitor className="size-5" /></span>
        <span className="text-xs font-semibold text-foreground">{youLabel}</span>
        {youNote && <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{youNote}</span>}
      </div>

      <div className="relative min-w-0 flex-1">
        {avg != null && (
          <span className={cn("num absolute -top-2 start-1/2 z-10 -translate-x-1/2 rounded-full border bg-card px-3 py-0.5 font-semibold lift rtl:translate-x-1/2", compact ? "text-xs" : "text-sm")} style={{ borderColor: `color-mix(in oklab, ${tone} 45%, var(--color-border))` }}>
            {label}
          </span>
        )}
        <svg viewBox={`0 0 ${W} 60`} className={cn("block w-full rtl:-scale-x-100", compact ? "h-10" : "h-14")} role="img" aria-label={`${avg == null ? "" : avg + " ms"}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`w${uid}`} x1="0" x2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.05" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="0.5" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <path d={path} stroke="var(--color-border)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" fill="none" />
          <path d={path} stroke={`url(#w${uid})`} strokeWidth="2" strokeLinecap="round" fill="none" />
          {packets.map((p) =>
            reduce ? (
              <circle key={p.i} cx={20 + ((p.i + 0.5) * (W - 40)) / N} cy={Y} r="4.5" fill="currentColor" opacity={p.lost ? 0.18 : 0.9} />
            ) : (
              <circle key={p.i} r="4.5" fill="currentColor" opacity="0">
                <animateMotion dur={`${dur}s`} begin={`${p.begin}s`} repeatCount="indefinite" path={path} />
                <animate
                  attributeName="opacity"
                  dur={`${dur}s`}
                  begin={`${p.begin}s`}
                  repeatCount="indefinite"
                  values={p.lost ? "0;1;1;0;0" : "0;1;1;0"}
                  keyTimes={p.lost ? "0;0.07;0.5;0.58;1" : "0;0.07;0.93;1"}
                />
              </circle>
            ),
          )}
        </svg>
      </div>

      <div className="flex w-24 shrink-0 flex-col items-center gap-1.5 text-center sm:w-32">
        <span className="flex h-11 items-center justify-center text-2xl">{server}</span>
        {serverNote && <span className="line-clamp-2 text-xs font-semibold text-foreground">{serverNote}</span>}
      </div>
    </div>
  );
}
