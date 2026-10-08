import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Command {
  id: string;
  label: string;
  /** the group it is listed under */
  group: string;
  icon: ReactNode;
  /** a small grey line beside the label (a shortcut, a game's number of scans...) */
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder: string;
  empty: string;
  title: string;
}

/**
 * Ctrl+K: type to find a command, arrow keys to move, Enter to run it. The same things the mouse does (start a scan, pick a game,
 * go to a page, switch the look), reachable without leaving the keyboard.
 */
export function CommandPalette({ open, onClose, commands, placeholder, empty, title }: Props) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? commands.filter((c) => (c.label + " " + c.group + " " + (c.hint ?? "")).toLowerCase().includes(needle)) : commands;
  }, [q, commands]);

  useEffect(() => { if (open) { setQ(""); setIndex(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => { setIndex(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);

  const go = (c?: Command) => { if (!c) return; onClose(); setTimeout(c.run, 0); };

  // one group heading per run of the same group
  let lastGroup = "";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
          style={{ background: "var(--scrim)" }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15 } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? false : { opacity: 0, y: -12, scale: 0.97, rotateX: 8, transformPerspective: 900 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
            className="lift w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(shown.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(shown[index]); }
            }}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
              />
              <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Esc</kbd>
            </div>
            <ul ref={list} role="listbox" aria-label={title} className="max-h-[52vh] overflow-y-auto p-1.5">
              {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</li>}
              {shown.map((c, i) => {
                const heading = c.group !== lastGroup;
                lastGroup = c.group;
                return (
                  <li key={c.id} role="presentation">
                    {heading && <div className="px-3 pb-1 pt-2.5 text-[11px] font-semibold text-muted-foreground">{c.group}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === index}
                      data-i={i}
                      onMouseMove={() => setIndex(i)}
                      onClick={() => go(c)}
                      className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm transition-colors", i === index ? "bg-primary/12 text-foreground" : "text-foreground/85")}
                    >
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-4", i === index ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-muted text-muted-foreground")}>{c.icon}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                      {c.hint && <span className="num shrink-0 text-xs text-muted-foreground">{c.hint}</span>}
                      {i === index && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
