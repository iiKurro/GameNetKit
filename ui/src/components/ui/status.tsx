// Adapted from "Status" by diceui (21st.dev/@diceui/components/status), without the Radix Slot dependency.
import type * as React from "react";
import { cn } from "@/lib/utils";

export type StatusVariant = "default" | "success" | "error" | "warning" | "info";

const variants: Record<StatusVariant, string> = {
  default: "border-transparent bg-muted text-muted-foreground [&_[data-dot]]:bg-muted-foreground",
  success: "border-success/25 bg-success/10 text-success [&_[data-dot]]:bg-success",
  error: "border-destructive/25 bg-destructive/10 text-destructive [&_[data-dot]]:bg-destructive",
  warning: "border-warning/25 bg-warning/10 text-warning [&_[data-dot]]:bg-warning",
  info: "border-info/25 bg-info/10 text-info [&_[data-dot]]:bg-info",
};

interface StatusProps extends React.ComponentProps<"div"> {
  variant?: StatusVariant;
  pulse?: boolean;
}

export function Status({ variant = "default", pulse = false, className, children, ...props }: StatusProps) {
  return (
    <div
      data-slot="status"
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    >
      <span className="relative flex size-2 shrink-0">
        {pulse && <span data-dot className="absolute inset-0 animate-ping rounded-full opacity-75 motion-reduce:animate-none" />}
        <span data-dot className="relative size-2 rounded-full" />
      </span>
      <span className="leading-none">{children}</span>
    </div>
  );
}
