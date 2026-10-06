// Adapted from "Server Card" by Mohammad Shehadeh / Hirael (MIT) - 21st.dev/@mohammadshehadeh/components/server-card
// Meter thresholds and spec cells reworked for ping / jitter / packet loss.
import * as React from "react";
import { cn } from "@/lib/utils";

export type ServerStatus = "good" | "ok" | "bad" | "noreply";

const tone: Record<ServerStatus, string> = {
  good: "bg-success text-success",
  ok: "bg-warning text-warning",
  bad: "bg-destructive text-destructive",
  noreply: "bg-muted-foreground text-muted-foreground",
};

export function ServerCard({ className, highlight, ...props }: React.ComponentProps<"div"> & { highlight?: boolean }) {
  return (
    <div
      data-slot="server-card"
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground",
        highlight ? "border-primary/50 shadow-[0_0_0_1px_rgba(53,208,127,.15)]" : "border-border",
        className,
      )}
      {...props}
    />
  );
}

export function ServerCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />;
}

export function ServerCardTitle({ region, className, children, ...props }: React.ComponentProps<"div"> & { region?: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <span className="num truncate text-sm font-medium text-foreground">{children}</span>
      {region ? <span className="text-xs break-words text-muted-foreground">{region}</span> : null}
    </div>
  );
}

export function ServerCardStatus({ status, children }: { status: ServerStatus; children: React.ReactNode }) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] font-medium",
        tone[status].split(" ")[1],
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone[status].split(" ")[0])} aria-hidden />
      {children}
    </span>
  );
}

export function ServerCardSpecs({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl className={cn("grid grid-cols-3 gap-3", className)} {...props} />;
}

export function ServerCardSpec({ label, className, children, ...props }: React.ComponentProps<"div"> & { label: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      <dt className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd className="num text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function ServerCardMeter({
  label,
  value,
  display,
  max,
  thresholds,
}: {
  label: React.ReactNode;
  value: number;
  display: string;
  /** value that fills the bar */
  max: number;
  /** [warn, crit] in the same unit as value */
  thresholds: [number, number];
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = value >= thresholds[1] ? "bg-destructive" : value >= thresholds[0] ? "bg-warning" : "bg-success";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="num text-foreground">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
