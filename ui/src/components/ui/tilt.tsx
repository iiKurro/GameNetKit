import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** the most the card leans, in degrees */
  max?: number;
  className?: string;
}

/**
 * A card that leans towards the pointer in perspective, with a soft light that follows it. It settles flat when the pointer leaves.
 * Touch and "reduce motion" get the plain card.
 */
export function Tilt({ children, max = 6, className }: Props) {
  const reduce = useReducedMotion();
  const el = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 220, damping: 20, mass: 0.6 });
  const ry = useSpring(useMotionValue(0), { stiffness: 220, damping: 20, mass: 0.6 });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={el}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || !el.current) return;
        const r = el.current.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        ry.set((px - 0.5) * 2 * max);
        rx.set(-(py - 0.5) * 2 * max);
        el.current.style.setProperty("--mx", `${px * 100}%`);
        el.current.style.setProperty("--my", `${py * 100}%`);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1100, transformStyle: "preserve-3d" }}
      className={cn("group/tilt relative will-change-transform", className)}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover/tilt:opacity-100"
        style={{ background: "radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklab, var(--color-foreground) 9%, transparent), transparent 62%)" }}
      />
    </motion.div>
  );
}
