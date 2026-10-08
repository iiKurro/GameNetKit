import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const token = () => (window as unknown as { __TOKEN__?: string }).__TOKEN__ ?? "";

function hueOf(name: string) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % 360;
}

/** the letters of the name (Latin ones), at most two: "Rocket League" -> RL, "Fortnite" -> F */
function initials(name: string) {
  const w = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** a cover drawn in vector, used while the real picture is not there (no internet the first time, or a game with no store page) */
function VectorCover({ name, wide }: { name: string; wide?: boolean }) {
  const h = hueOf(name);
  const id = `vc${h}${wide ? "w" : ""}`;
  if (wide) {
    return (
      <svg viewBox="0 0 480 160" preserveAspectRatio="xMidYMid slice" className="size-full" aria-hidden>
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(${h} 38% 12%)`} />
            <stop offset="1" stopColor={`hsl(${(h + 40) % 360} 55% 26%)`} />
          </linearGradient>
          <radialGradient id={`${id}b`} cx="0.85" cy="0.2" r="0.7">
            <stop offset="0" stopColor={`hsl(${h} 90% 62%)`} stopOpacity="0.5" />
            <stop offset="1" stopColor={`hsl(${h} 90% 62%)`} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="480" height="160" fill={`url(#${id}a)`} />
        <rect width="480" height="160" fill={`url(#${id}b)`} />
        <g fill="none" stroke={`hsl(${h} 80% 70%)`} strokeOpacity="0.25" strokeWidth="1.2">
          <circle cx="410" cy="36" r="30" /><circle cx="410" cy="36" r="52" /><circle cx="410" cy="36" r="78" />
          <path d="M-10 150 L500 40" /><path d="M-10 170 L500 60" /><path d="M-10 190 L500 80" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 180" preserveAspectRatio="xMidYMid slice" className="size-full" aria-hidden>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 38% 13%)`} />
          <stop offset="1" stopColor={`hsl(${(h + 40) % 360} 55% 27%)`} />
        </linearGradient>
        <radialGradient id={`${id}b`} cx="0.8" cy="0.18" r="0.7">
          <stop offset="0" stopColor={`hsl(${h} 90% 62%)`} stopOpacity="0.55" />
          <stop offset="1" stopColor={`hsl(${h} 90% 62%)`} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="180" fill={`url(#${id}a)`} />
      <rect width="120" height="180" fill={`url(#${id}b)`} />
      <g fill="none" stroke={`hsl(${h} 80% 70%)`} strokeOpacity="0.28" strokeWidth="1.2">
        <circle cx="96" cy="34" r="22" /><circle cx="96" cy="34" r="38" /><circle cx="96" cy="34" r="56" />
        <path d="M-10 150 L130 96" /><path d="M-10 168 L130 114" /><path d="M-10 186 L130 132" />
      </g>
      <text x="12" y="160" fontFamily="'Cairo Variable', 'Segoe UI', sans-serif" fontSize="34" fontWeight="800" fill="#fff" fillOpacity="0.9" letterSpacing="-1">{initials(name)}</text>
    </svg>
  );
}

interface Props {
  name: string;
  slug?: string;
  /** "cover" is the tall picture, "hero" the wide banner */
  kind?: "cover" | "hero";
  className?: string;
}

/** The picture of a game (from the store of the game, kept on this PC); a vector cover while it is not there. */
export function GameCover({ name, slug, kind = "cover", className }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "none">(slug ? "loading" : "none");
  const [attempt, setAttempt] = useState(0);
  // not there yet (no internet the first time): ask again a few times, slowly
  useEffect(() => {
    if (state !== "none" || !slug || attempt >= 4) return;
    const id = setTimeout(() => { setAttempt((n) => n + 1); setState("loading"); }, 20000 * (attempt + 1));
    return () => clearTimeout(id);
  }, [state, slug, attempt]);
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <div className={cn("absolute inset-0 transition-opacity duration-300", state === "ok" ? "opacity-0" : "opacity-100")}><VectorCover name={name} wide={kind === "hero"} /></div>
      {slug && state !== "none" && (
        <img
          src={`/art/${slug}/${kind}?t=${token()}${attempt ? `&r=${attempt}` : ""}`}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("none")}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}
