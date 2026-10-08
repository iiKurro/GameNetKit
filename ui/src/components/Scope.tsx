import type { ReactNode } from "react";
import { ShieldCheck, Timer } from "lucide-react";
import type { Phase } from "@/api";
import { ScanGlobe, type ScanMode } from "@/components/ScanGlobe";

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
  /** the wide picture of the game, across the top */
  banner?: ReactNode;
  /** the player's own place, shown as a quiet marker */
  home?: { lat: number; lon: number } | null;
}

/**
 * The scan stage: the game's banner, then the scan globe. It turns slowly while idle, its beam sweeps faster while the game's traffic is
 * captured (the numbers beside it are the real count of ports and seconds left) and keeps sweeping while the servers are measured.
 * (When the scan is over the globe locks on to the server: that part is the ScanGlobe in "locked" mode, shown with the results.)
 */
export function Scope({ phase, ports, secondsLeft, portsText, title, text, game, help, banner, home }: Props) {
  const live = phase === "capturing";
  const mode: ScanMode = live ? "capture" : phase === "analyzing" || phase === "measuring" ? "measure" : phase === "elevating" || phase === "waiting_game" || phase === "ready" ? "wait" : "idle";

  return (
    <div className="flex flex-col items-stretch text-center">
      {banner}
      <div className="relative -mt-16">
        <ScanGlobe mode={mode} home={home} label={title} className="h-[300px] w-full" />
        {live && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="inline-flex items-center gap-3 rounded-full border border-border bg-card/85 px-3.5 py-1.5 text-xs font-semibold text-foreground backdrop-blur">
              <span className="inline-flex items-center gap-1.5"><Timer className="size-3.5 text-primary" /><span className="num text-sm">{secondsLeft}</span></span>
              <span className="h-3.5 w-px bg-border" aria-hidden />
              <span className="text-muted-foreground"><span className="num text-foreground">{ports}</span> {portsText}</span>
            </span>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-md px-4 pb-6 pt-1" aria-live="polite">
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
