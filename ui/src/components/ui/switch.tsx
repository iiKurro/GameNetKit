// Adapted from "Switch" by halaska-studio (21st.dev/@halaska-studio/components/switch): role=switch, spring thumb that
// stretches while pressed. Rebuilt on motion's layout animation so it mirrors by itself in right-to-left pages
// (flex start / end instead of left / right) and respects the system "reduce motion" setting.
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** shows the thumb as busy while an admin prompt or a request is pending */
  busy?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Switch({ checked, onChange, disabled, busy, ...aria }: Props) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 outline-none transition-colors duration-200",
        "focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "justify-end bg-primary" : "justify-start bg-muted-foreground/30",
      )}
      {...aria}
    >
      <motion.span
        layout
        whileTap={reduce ? undefined : { width: 24 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
        className={cn("block h-5 w-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.35)]", checked ? "bg-primary-foreground" : "bg-foreground", busy && "animate-pulse")}
      />
    </button>
  );
}
