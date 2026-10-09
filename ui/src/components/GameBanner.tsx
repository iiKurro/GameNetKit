import { useRef } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { GameCover } from "@/components/GameCover";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  slug?: string;
  /** small line under the name, e.g. "6 scans" */
  note?: string;
  className?: string;
}

// the picture melts into the page: solid at the top, then a long, soft fall-off to nothing (so there is no edge where it stops)
const MELT = "linear-gradient(to bottom, #000 0%, #000 32%, rgba(0,0,0,0.78) 48%, rgba(0,0,0,0.42) 64%, rgba(0,0,0,0.14) 78%, transparent 90%)";

/**
 * The picture of the chosen game, wide, at the top of the scan page. It dissolves downwards into the page, drifts a little against the
 * pointer (a quiet depth), and a change of game fades the new picture in while it settles from a slightly larger size.
 */
export function GameBanner({ name, slug, note, className }: Props) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const px = useSpring(useMotionValue(0), { stiffness: 90, damping: 20 });
  const py = useSpring(useMotionValue(0), { stiffness: 90, damping: 20 });
  const shiftX = useTransform(px, (v) => v * -14);
  const shiftY = useTransform(py, (v) => v * -8);
  const textX = useTransform(px, (v) => v * 6);

  return (
    <div
      ref={box}
      className={cn("relative h-[190px] overflow-hidden sm:h-[236px]", className)}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse" || !box.current) return;
        const r = box.current.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { px.set(0); py.set(0); }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={name}
          className="absolute -inset-4"
          style={{ x: shiftX, y: shiftY, WebkitMaskImage: MELT, maskImage: MELT }}
          initial={reduce ? false : { opacity: 0, scale: 1.1 }}
          animate={{ opacity: 1, scale: 1.02, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
        >
          <GameCover name={name} slug={slug} kind="hero" className="size-full" />
          {/* a soft dark foot under the picture, so the name stays readable in the light look as well (it melts away with the picture) */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/50 to-transparent" />
        </motion.div>
      </AnimatePresence>
      {/* a little darkness at the very top, so the picture sits in the card instead of on it */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/35 to-transparent" />
      <motion.div style={{ x: textX }} className="absolute inset-x-0 bottom-[4.5rem] px-6">
        <h2 className="truncate text-3xl font-extrabold leading-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.75)]" dir="auto">{name}</h2>
        {note && <p className="num mt-0.5 text-xs font-medium text-white/80 drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">{note}</p>}
      </motion.div>
    </div>
  );
}
