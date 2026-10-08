import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import poster from "@/assets/promo-poster.jpg";

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const token = () => (window as unknown as { __TOKEN__?: string }).__TOKEN__ ?? "";

interface Props {
  t: (k: Key) => string;
  className?: string;
  /** small tile: the big button and the bar stay, the time text goes */
  compact?: boolean;
}

/**
 * The intro video that is inside the app. A still frame and one clear play button until it starts; then a quiet control bar
 * (play, a seekable line, time, fullscreen) that fades away while it plays and returns on hover, touch or keyboard focus.
 */
export function PromoPlayer({ t, className, compact }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(38);
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => setTime(v.currentTime);
    const meta = () => { if (Number.isFinite(v.duration)) setLength(v.duration); };
    const on = { timeupdate: tick, loadedmetadata: meta, play: () => { setPlaying(true); setStarted(true); setEnded(false); }, pause: () => setPlaying(false), ended: () => { setPlaying(false); setEnded(true); }, error: () => setFailed(true) };
    for (const [k, f] of Object.entries(on)) v.addEventListener(k, f);
    return () => { for (const [k, f] of Object.entries(on)) v.removeEventListener(k, f); };
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (ended) { v.currentTime = 0; }
    if (v.paused || ended) void v.play().catch(() => setFailed(true)); else v.pause();
  }, [ended]);

  const seekTo = useCallback((clientX: number) => {
    const v = video.current, b = bar.current;
    if (!v || !b) return;
    const r = b.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = f * (Number.isFinite(v.duration) ? v.duration : length);
    setTime(v.currentTime);
  }, [length]);

  const dragging = useRef(false);
  const full = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  };

  const pct = length ? Math.min(100, (100 * time) / length) : 0;
  const showBar = !playing || near;

  return (
    <div
      ref={box}
      className={cn("group relative aspect-video overflow-hidden rounded-2xl border border-border bg-black lift [&:fullscreen]:rounded-none [&:fullscreen]:border-0", className)}
      onPointerEnter={() => setNear(true)}
      onPointerLeave={() => setNear(false)}
      onFocus={() => setNear(true)}
      onBlur={() => setNear(false)}
      onPointerDown={() => setNear(true)}
    >
      <video
        ref={video}
        src={`/promo.mp4?t=${token()}`}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={toggle}
        className="size-full cursor-pointer object-cover"
      />

      {/* the one big action while nothing plays */}
      {!playing && !failed && (
        <button
          type="button"
          onClick={toggle}
          aria-label={ended ? t("svReplay") : t("svPlay")}
          className="absolute inset-0 flex cursor-pointer items-center justify-center bg-gradient-to-t from-black/55 via-black/10 to-black/20 outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset"
        >
          <span className={cn("flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] transition-transform duration-200 group-hover:scale-105", compact ? "size-12" : "size-16")}>
            {ended ? <RotateCcw className={compact ? "size-5" : "size-7"} /> : <Play className={cn("fill-current", compact ? "size-5" : "size-7")} />}
          </span>
          {!started && !compact && (
            <span className="absolute bottom-14 start-5 text-sm font-semibold text-white drop-shadow">{t("svWatch")}</span>
          )}
        </button>
      )}

      {failed && <div role="alert" className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white">{t("svVideoError")}</div>}

      {/* controls: always readable (ltr, a video timeline runs left to right) */}
      <div
        dir="ltr"
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 transition-opacity duration-200",
          showBar ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button type="button" onClick={toggle} aria-label={playing ? t("svPause") : t("svPlay")} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-primary/70">
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </button>
        <div
          ref={bar}
          role="slider"
          tabIndex={0}
          aria-label={t("svSeek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(length)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} / ${clock(length)}`}
          onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seekTo(e.clientX); }}
          onPointerMove={(e) => { if (dragging.current) seekTo(e.clientX); }}
          onPointerUp={() => { dragging.current = false; }}
          onKeyDown={(e) => {
            const v = video.current;
            if (!v) return;
            if (e.key === "ArrowRight") { v.currentTime = Math.min(length, v.currentTime + 5); e.preventDefault(); }
            else if (e.key === "ArrowLeft") { v.currentTime = Math.max(0, v.currentTime - 5); e.preventDefault(); }
            else if (e.key === " " || e.key === "Enter") { toggle(); e.preventDefault(); }
          }}
          className="group/bar relative flex h-6 min-w-0 flex-1 cursor-pointer items-center outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-0"
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/bar:h-1.5">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="absolute size-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100" style={{ left: `${pct}%` }} />
        </div>
        {!compact && <span className="num shrink-0 text-xs font-medium text-white/85">{clock(time)} / {clock(length)}</span>}
        <button type="button" onClick={full} aria-label={t("svFullscreen")} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-primary/70">
          <Maximize2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
