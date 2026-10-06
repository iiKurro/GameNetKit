import { useEffect, useRef, useState } from "react";

/** counts up to a number once when it appears (and again whenever it changes); instant when the system asks for less motion */
export function useCountUp(target: number | null, ms = 900): number {
  const [v, setV] = useState(target ?? 0);
  const from = useRef(0);
  useEffect(() => {
    if (target == null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || ms <= 0) { setV(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);   // exponential ease-out
      setV(Math.round(a + (target - a) * e));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return target == null ? 0 : v;
}
