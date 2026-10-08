import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One raised panel that holds a few related settings as rows divided by hairlines. */
export function SettingGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("lift overflow-hidden rounded-2xl border border-border bg-card", className)}>{children}</div>;
}

interface RowProps {
  /** text id, so the control can name itself by it */
  id?: string;
  title: ReactNode;
  /** one line that says what flipping it does */
  hint?: ReactNode;
  /** the control: a switch, a segmented choice, a button */
  control?: ReactNode;
  /** anything that belongs under the text (a status line, a warning) */
  children?: ReactNode;
  tone?: "normal" | "warning";
}

export function SettingRow({ id, title, hint, control, children, tone = "normal" }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 py-3.5 last:border-b-0 sm:px-5">
      <div className="min-w-0 flex-1 basis-60">
        <div id={id} className="text-sm font-semibold">{title}</div>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        {children && <div className={cn("mt-2 text-xs leading-relaxed", tone === "warning" ? "text-warning" : "text-muted-foreground")}>{children}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}
