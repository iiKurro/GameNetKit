import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------------------------------ the little drawings
   One 64 x 64 drawing per section, all in the same stroke and the same two-tone way: the colour of the section and a lighter echo of it. */

const stroke = { strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ScanArt() {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <circle cx="32" cy="32" r="21" stroke="currentColor" strokeOpacity="0.55" fill="none" {...stroke} />
      <circle cx="32" cy="32" r="11" stroke="currentColor" strokeOpacity="0.35" fill="none" {...stroke} />
      <path d="M32 32 L32 11 A21 21 0 0 1 50.2 21.5 Z" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <path d="M32 32 L50.2 21.5" stroke="currentColor" fill="none" {...stroke} />
      <circle cx="42" cy="23" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="32" cy="32" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HistoryArt() {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <path d="M13 32a19 19 0 1 0 5.6-13.4" stroke="currentColor" strokeOpacity="0.55" fill="none" {...stroke} />
      <path d="M13 12 L13.6 20.2 L21.6 19.6" stroke="currentColor" strokeOpacity="0.55" fill="none" {...stroke} />
      <path d="M32 21 L32 32.5 L40 37" stroke="currentColor" fill="none" {...stroke} />
      <path d="M20 47 v4 M32 49 v2 M44 46 v5" stroke="currentColor" strokeOpacity="0.35" fill="none" {...stroke} />
    </svg>
  );
}

export function InsightsArt() {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <path d="M32 12a14 14 0 0 0-8 25.5c1.6 1.2 2.4 2.7 2.4 4.5h11.2c0-1.8.8-3.3 2.4-4.5A14 14 0 0 0 32 12Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" {...stroke} />
      <path d="M27 47h10 M29 52h6" stroke="currentColor" fill="none" {...stroke} />
      <path d="M32 21v10 M27.5 26.5 32 31l4.5-4.5" stroke="currentColor" strokeOpacity="0.7" fill="none" {...stroke} />
      <path d="M12 20l3 2 M52 20l-3 2 M10 34h4 M50 34h4" stroke="currentColor" strokeOpacity="0.45" fill="none" {...stroke} />
    </svg>
  );
}

export function BlockedArt() {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <path d="M32 9 L51 16 V30c0 11.5-7.6 19.6-19 25C20.6 49.6 13 41.5 13 30V16Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" {...stroke} />
      <circle cx="32" cy="31" r="9" stroke="currentColor" strokeOpacity="0.7" fill="none" {...stroke} />
      <path d="M25.6 37.4 L38.4 24.6" stroke="currentColor" fill="none" {...stroke} />
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------------------ the dock */

export interface DockItem {
  id: string;
  label: string;
  art: ReactNode;
  /** text colour of the drawing (a Tailwind text-* class) */
  tint: string;
  count?: number;
  danger?: boolean;
}

interface Props {
  items: DockItem[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}

const BASE = 50, PEAK = 74, REACH = 120;

function Tile({ item, active, mouse, hovered, setHovered, onChange, reduce }: {
  item: DockItem; active: boolean; mouse: MotionValue<number>; hovered: string | null; setHovered: (id: string | null) => void; onChange: () => void; reduce: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const distance = useTransform(mouse, (m) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? m - (r.left + r.width / 2) : Infinity;
  });
  const raw = useTransform(distance, [-REACH, 0, REACH], [BASE, PEAK, BASE]);
  const size = useSpring(raw, { mass: 0.12, stiffness: 190, damping: 15 });

  return (
    <div className="relative flex flex-col items-center">
      <motion.button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={item.label}
        onClick={onChange}
        onPointerEnter={() => setHovered(item.id)}
        onFocus={() => setHovered(item.id)}
        onBlur={() => setHovered(null)}
        style={reduce ? { width: BASE, height: BASE } : { width: size, height: size }}
        className={cn(
          "relative flex cursor-pointer items-center justify-center rounded-[16px] border p-[18%] outline-none transition-[border-color,box-shadow,background-color] duration-200",
          "bg-gradient-to-b from-white/[0.07] to-white/[0.015] focus-visible:ring-2 focus-visible:ring-primary/70",
          item.tint,
          active ? "border-current/50 shadow-[0_0_0_1px_color-mix(in_oklab,currentColor_35%,transparent),0_10px_26px_-10px_currentColor]" : "border-border hover:border-current/40",
        )}
      >
        <span className={cn("size-full transition-transform duration-300", active && "scale-105")}>{item.art}</span>
        {(item.count ?? 0) > 0 && (
          <span className={cn("num absolute -end-1.5 -top-1.5 flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-foreground ring-2 ring-card", item.danger ? "bg-destructive/90 text-white" : "bg-muted-foreground/35")}>{item.count}</span>
        )}
      </motion.button>

      {/* the name: small and light, under the tile that the pointer is on, gone as soon as it moves to another one */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute top-full mt-1.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground transition-[opacity,transform] duration-150", hovered === item.id ? "translate-y-0 opacity-100" : "-translate-y-0.5 opacity-0")}
      >
        {item.label}
      </span>
      <span aria-hidden className={cn("absolute top-full mt-2 size-1 rounded-full bg-current transition-opacity duration-200", item.tint, active && hovered !== item.id ? "opacity-90" : "opacity-0")} />
    </div>
  );
}

/**
 * The main sections as a row of small square tiles with a drawing on each. The tiles swell as the pointer comes near (like a dock),
 * the name of the tile under the pointer appears below it, and the chosen section keeps a glow and a dot.
 */
export function NavDock({ items, active, onChange, label }: Props) {
  const reduce = !!useReducedMotion();
  const mouse = useMotionValue(Infinity);
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div className="flex justify-center">
      <motion.div
        role="tablist"
        aria-label={label}
        onPointerMove={(e) => { if (e.pointerType === "mouse") mouse.set(e.clientX); }}
        onPointerLeave={() => { mouse.set(Infinity); setHovered(null); }}
        className="lift flex h-[calc(74px+2.25rem)] items-start gap-3 rounded-[22px] border border-border bg-card/80 px-4 pt-3 backdrop-blur-md"
      >
        {items.map((it) => (
          <Tile key={it.id} item={it} active={it.id === active} mouse={mouse} hovered={hovered} setHovered={setHovered} onChange={() => onChange(it.id)} reduce={reduce} />
        ))}
      </motion.div>
    </div>
  );
}
