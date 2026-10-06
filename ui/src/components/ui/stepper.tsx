// Adapted from "Vertical Titled Stepper" by sean0205 (21st.dev/@sean0205/components/c-stepper-15).
// Controlled, display-only, RTL friendly (logical properties), no Radix dependency.
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  title: string;
  hint?: string;
}

interface StepperProps {
  steps: Step[];
  /** 1-based index of the current step; steps before it are completed. */
  current: number;
  /** show a spinner on the current step */
  loading?: boolean;
  /** mark every step completed */
  done?: boolean;
  className?: string;
}

export function VerticalStepper({ steps, current, loading, done, className }: StepperProps) {
  return (
    <nav aria-label="progress" className={cn("flex flex-col", className)}>
      {steps.map((step, i) => {
        const n = i + 1;
        const state = done || n < current ? "completed" : n === current ? "active" : "inactive";
        const last = i === steps.length - 1;
        return (
          <div key={step.title} data-state={state} className="relative flex items-start gap-3 pb-7 last:pb-0">
            {!last && (
              <div
                className={cn(
                  "absolute start-3 top-7 h-[calc(100%-1.75rem)] w-0.5 -translate-x-1/2 rounded-full bg-muted rtl:translate-x-1/2",
                  state === "completed" && "bg-success",
                )}
              />
            )}
            <div
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                state === "completed" && "bg-success text-primary-foreground",
                state === "active" && "bg-primary text-primary-foreground",
                state === "inactive" && "bg-accent text-muted-foreground",
              )}
            >
              {state === "completed" ? (
                <CheckIcon className="size-3.5" />
              ) : state === "active" && loading ? (
                <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <span className="num">{n}</span>
              )}
            </div>
            <div className="min-w-0 pt-0.5">
              <div className={cn("text-sm font-medium leading-none", state === "inactive" && "text-muted-foreground")}>{step.title}</div>
              {step.hint && state === "active" && <div className="mt-1.5 text-xs text-muted-foreground">{step.hint}</div>}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
