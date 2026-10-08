import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  decimals?: number;
  /** text written after the number, e.g. " ms" */
  suffix?: string;
  /** how long the count takes, in milliseconds */
  ms?: number;
  className?: string;
}

/** A number that counts up to its value (and moves from the old value to a new one) instead of just appearing. Plain when motion is reduced. */
export function CountUp({ value, decimals = 0, suffix = "", ms = 900, className }: Props) {
  const [shown, setShown] = useState(() => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const v = a + (value - a) * e;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className={className}>{shown.toFixed(decimals)}{suffix}</span>;
}
