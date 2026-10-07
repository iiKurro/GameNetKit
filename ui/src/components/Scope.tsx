import { motion, useReducedMotion } from "motion/react";
import { Activity, Gamepad2, Hourglass, Radar, ShieldCheck } from "lucide-react";
import type { Phase } from "@/api";
import { cn } from "@/lib/utils";

interface Props {
  phase: Phase;
  ports: number;
  secondsLeft: number;
  /** "3 game ports" */
  portsText: string;
  title: string;
  text: string;
  game?: string;
  /** shown while the app waits for the game: "the game is running but it does not see it" */
  help?: { label: string; onClick: () => void };
}

const SIZE = 320;
const C = SIZE / 2;

/** where the n-th game port shows up on the scope: fixed pseudo-random spots, so they do not jump around between renders */
const spot = (n: number) => {
  const a = Math.sin(n * 91.7 + 12.3) * 10000; const b = Math.sin(n * 47.3 + 5.1) * 10000;
  const angle = (a - Math.floor(a)) * Math.PI * 2;
  const r = 0.28 + (b - Math.floor(b)) * 0.62;
  return { x: C + Math.cos(angle) * r * (C - 14), y: C + Math.sin(angle) * r * (C - 14) };
};

/**
 * The scan "scope": an idle radar before a scan, a faster sweep while the game's traffic is captured (one blip for every game port
 * seen, so the numbers on screen are the real count), and a held ring while the servers are measured.
 */
export function Scope({ phase, ports, secondsLeft, portsText, title, text, game, help }: Props) {
  const reduce = useReducedMotion();
  const live = phase === "capturing";
  const wait = phase === "elevating" || phase === "waiting_game" || phase === "ready";
  const measuring = phase === "analyzing" || phase === "measuring";
  const speed = live ? "2.6s" : measuring ? "1.6s" : wait ? "5.5s" : "9s";
  const Icon = live ? Radar : measuring ? Activity : wait ? Hourglass : Gamepad2;

  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center sm:py-8">
      <div className="relative" style={{ width: "min(100%, 320px)", aspectRatio: "1" }} aria-hidden>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full">
          {[0.97, 0.66, 0.35].map((k) => (
            <circle key={k} cx={C} cy={C} r={(C - 4) * k} fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeDasharray={k === 0.97 ? "0" : "2 6"} />
          ))}
          <line x1={C} y1="6" x2={C} y2={SIZE - 6} stroke="var(--color-border)" strokeWidth="1" />
          <line x1="6" y1={C} x2={SIZE - 6} y2={C} stroke="var(--color-border)" strokeWidth="1" />
          {live && Array.from({ length: Math.min(ports, 10) }, (_, n) => {
            const p = spot(n + 1);
            return (
              <g key={n}>
                <circle cx={p.x} cy={p.y} r="12" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" className="ring" style={{ animationDelay: `${n * 0.35}s` }} />
                <circle cx={p.x} cy={p.y} r="4" fill="var(--color-primary)" className="blip" style={{ animationDelay: `${n * 0.2}s` }} />
              </g>
            );
          })}
        </svg>
        {/* the sweep: a conic wedge that fades behind a bright leading edge */}
        <div
          className={cn("sweep absolute inset-[3%] rounded-full", phase === "idle" && "opacity-60")}
          style={{
            ["--sweep-speed" as string]: speed,
            background: "conic-gradient(from 0deg, transparent 0deg, transparent 292deg, color-mix(in oklab, var(--color-primary) 34%, transparent) 360deg)",
            maskImage: "radial-gradient(circle, #000 98%, transparent 100%)",
          }}
        >
          <span className="absolute start-1/2 top-0 h-1/2 w-0.5 -translate-x-1/2 rounded-full bg-primary rtl:translate-x-1/2" />
        </div>
        <motion.div
          key={phase}
          initial={reduce ? false : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className="flex size-16 items-center justify-center rounded-full border border-border bg-card text-primary lift">
            {live ? <span className="num text-2xl font-bold text-foreground">{secondsLeft}</span> : <Icon className="size-7" />}
          </span>
          {live && <span className="mt-2 text-[11px] font-medium text-muted-foreground"><span className="num">{ports}</span> {portsText}</span>}
        </motion.div>
      </div>

      <div className="max-w-md" aria-live="polite">
        {game && phase !== "idle" && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> {game}
          </div>
        )}
        <h2 className="text-lg font-bold text-balance">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{text}</p>
        {help && phase === "waiting_game" && (
          <button onClick={help.onClick} className="mt-3 cursor-pointer text-sm font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
            {help.label}
          </button>
        )}
      </div>
    </div>
  );
}
