// Adapted from "Animated Tabs" by educalvolpz (21st.dev/@educalvolpz/components/animated-tabs), "segment" variant.
// The highlight slides to the active tab (shared layout animation) so the eye follows where it went; arrow / Home / End keys
// move between tabs. Each tab can carry an icon and a count.
import { type ReactNode, useCallback, useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  /** count badge colour: neutral or "danger" (used for the blocked list) */
  countTone?: "neutral" | "danger";
}

interface Props {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  label?: string;
}

const SPRING = { type: "spring" as const, duration: 0.28, bounce: 0.05 };

export function AnimatedTabs({ tabs, active, onChange, className, label }: Props) {
  const reduce = useReducedMotion();
  const uid = useId();

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      // arrow keys follow the reading direction of the page
      const rtl = document.documentElement.dir === "rtl";
      let next = index;
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = (index + 1) % tabs.length;
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      onChange(tabs[next].id);
      document.getElementById(`${uid}-${tabs[next].id}`)?.focus();
    },
    [tabs, onChange, uid],
  );

  return (
    <div role="tablist" aria-label={label} className={cn("relative flex gap-0 rounded-xl border border-border bg-card p-1", className)}>
      {tabs.map((tab, i) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`${uid}-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium outline-none transition-colors sm:px-3",
              "focus-visible:ring-2 focus-visible:ring-primary/60",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && (
              <motion.span
                layoutId={`${uid}-pill`}
                transition={reduce ? { duration: 0 } : SPRING}
                className="absolute inset-0 rounded-lg border border-border bg-accent shadow-sm"
              />
            )}
            {tab.icon && <span className={cn("relative z-10 [&_svg]:size-4", on && "text-primary")}>{tab.icon}</span>}
            <span className="relative z-10 max-[540px]:sr-only">{tab.label}</span>
            {tab.count != null && tab.count > 0 && (
              <span
                className={cn(
                  "num relative z-10 rounded-full px-1.5 text-[11px]",
                  tab.countTone === "danger" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
