import { useCallback, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { GameCover } from "@/components/GameCover";

interface G { name: string; slug?: string }

interface Props {
  games: G[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  /** saved scans per game: shown under the name */
  counts: Record<string, number>;
  rtl: boolean;
  label: string;
  /** "3 scans" style text for the count under the name */
  countText: (n: number) => string;
}

// wide cards (the wide picture of each game), in a row as wide as the page: the chosen one stands square, the others swing away
const CARD_W = 214, CARD_H = 134, VISIBLE = 3;

/**
 * The games as a coverflow across the page. Click a card, drag or swipe sideways, use the arrow keys or the wheel. It reads in the page's own
 * direction: the first game is on the start side.
 */
export function GameCarousel({ games, value, onChange, disabled, counts, rtl, label, countText }: Props) {
  const reduce = useReducedMotion();
  const index = Math.max(0, games.findIndex((g) => g.name === value));
  const f = rtl ? -1 : 1;                       // the screen's left-right against the list order
  const drag = useRef<{ x: number; at: number } | null>(null);
  const wheelAt = useRef(0);

  const go = useCallback((to: number) => {
    if (disabled || !games.length) return;
    const i = Math.max(0, Math.min(games.length - 1, to));
    if (i !== index) onChange(games[i].name);
  }, [disabled, games, index, onChange]);

  const current = games[index];

  return (
    <section aria-label={label} className="relative flex flex-col items-center">
      {/* a soft light under the row, so the cards float */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] top-[58%] h-24 rounded-[50%] bg-primary/10 blur-3xl" />
      <div
        role="listbox"
        aria-label={label}
        aria-activedescendant={current ? `game-${index}` : undefined}
        tabIndex={0}
        dir="ltr"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { go(index + f); e.preventDefault(); }
          else if (e.key === "ArrowLeft") { go(index - f); e.preventDefault(); }
          else if (e.key === "Home") { go(0); e.preventDefault(); }
          else if (e.key === "End") { go(games.length - 1); e.preventDefault(); }
        }}
        onWheel={(e) => {
          const now = performance.now();
          if (now - wheelAt.current < 240 || Math.abs(e.deltaX) < 8) return;     // only a sideways wheel: the page's own scrolling stays
          wheelAt.current = now;
          go(index + (e.deltaX > 0 ? 1 : -1));
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, at: index }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const steps = Math.round((d.x - e.clientX) / 84);        // dragging to the left brings the card that is on the right
          if (steps !== 0) go(d.at + steps * f);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
        className="relative h-[206px] w-full touch-pan-y select-none overflow-hidden rounded-2xl outline-none [perspective:1100px] focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {games.map((g, i) => {
          const d = (i - index) * f;                 // distance from the middle, on the screen (negative = left)
          const a = Math.abs(d);
          const hidden = a > VISIBLE;
          return (
            <motion.button
              key={g.name}
              id={`game-${i}`}
              type="button"
              role="option"
              aria-selected={i === index}
              aria-label={g.name}
              disabled={disabled && i !== index}
              onClick={() => go(i)}
              tabIndex={-1}
              initial={false}
              animate={{
                x: a === 0 ? 0 : Math.sign(d) * (176 + (a - 1) * 112),
                rotateY: reduce || a === 0 ? 0 : -Math.sign(d) * (36 + (a - 1) * 8),
                z: -a * 95,
                scale: a === 0 ? 1.1 : 1 - a * 0.085,
                opacity: hidden ? 0 : 1 - a * 0.16,
              }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28, mass: 0.95 }}
              style={{ width: CARD_W, height: CARD_H, left: "50%", marginLeft: -CARD_W / 2, top: 26, zIndex: 10 - Math.round(a), pointerEvents: hidden ? "none" : "auto", transformStyle: "preserve-3d" }}
              className={cn(
                "absolute cursor-pointer rounded-2xl outline-none",
                i === index
                  ? "shadow-[0_22px_40px_-14px_rgba(0,0,0,0.85),0_0_0_1.5px_color-mix(in_oklab,var(--color-primary)_75%,transparent),0_0_34px_-6px_color-mix(in_oklab,var(--color-primary)_50%,transparent)]"
                  : "shadow-[0_18px_30px_-14px_rgba(0,0,0,0.8)]",
                disabled && i !== index && "cursor-default",
              )}
            >
              <GameCover name={g.name} slug={g.slug} kind="hero" className="size-full rounded-2xl" />
              {/* a soft shine across the card, a darker edge for the cards that turn away */}
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/18 via-transparent to-black/30" />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl bg-black transition-opacity duration-300" style={{ opacity: Math.min(0.6, a * 0.2) }} />
            </motion.button>
          );
        })}
      </div>

      <div className="-mt-1 min-h-[2.75rem] text-center" aria-live="polite">
        <div className="text-base font-extrabold" dir="auto">{current?.name}</div>
        {current && (counts[current.name] ?? 0) > 0 && <div className="num mt-0.5 text-xs text-muted-foreground">{countText(counts[current.name])}</div>}
      </div>
    </section>
  );
}
