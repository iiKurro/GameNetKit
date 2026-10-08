import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { isLand } from "@/lib/geo";

export type ScanMode = "idle" | "wait" | "capture" | "measure" | "locked";
export type ScanTone = "good" | "ok" | "bad" | "idle";

export interface ScanTarget {
  id: string;
  lat: number;
  lon: number;
  tone: ScanTone;
}

interface Props {
  mode: ScanMode;
  /** every server found; the one named by lockId is the one the scanner locks on to */
  targets?: ScanTarget[];
  lockId?: string;
  /** the player's own place: a quiet marker */
  home?: { lat: number; lon: number } | null;
  className?: string;
  label: string;
  /** the label card beside the locked point (HTML, so Arabic and numbers lay out correctly) */
  children?: React.ReactNode;
}

const DEG = Math.PI / 180;
const BASE_TILT = 0.34;
const STEP = 1;   // degrees per land tile

interface Tile { x: number; y: number; z: number }

// land as small square tiles of the lat / lon grid: a different look from the dotted globe of the insights page
function landTiles(): Tile[] {
  const out: Tile[] = [];
  for (let lat = -88; lat <= 88; lat += STEP) {
    for (let lon = -179; lon <= 179; lon += STEP) {
      if (!isLand(lat, lon)) continue;
      const c = Math.cos(lat * DEG);
      out.push({ x: c * Math.sin(lon * DEG), y: Math.sin(lat * DEG), z: c * Math.cos(lon * DEG) });
    }
  }
  return out;
}

const vec = (lat: number, lon: number): [number, number, number] => { const c = Math.cos(lat * DEG); return [c * Math.sin(lon * DEG), Math.sin(lat * DEG), c * Math.cos(lon * DEG)]; };
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * The scan globe. Land is drawn as glowing tiles over a lat / lon grid, and a radar beam sweeps across the face of the globe; the beam
 * speeds up while the game is captured. When the scan has its answer (mode "locked") the globe turns to the server, zooms in, closes a
 * targeting frame on the exact point, sends out rings and raises a pin: the point is marked where it really is.
 */
export function ScanGlobe({ mode, targets = [], lockId, home, className, label, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const tiles = useMemo(landTiles, []);
  const live = useRef({ mode, targets, lockId, home });
  live.current = { mode, targets, lockId, home };
  const lockedAt = useRef<number | null>(null);

  useEffect(() => {
    const canvas = cv.current, wrap = box.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1;
    const size = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(10, r.width); h = Math.max(10, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(wrap);

    const css = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (n: string) => s.getPropertyValue(n).trim();
      return { fg: g("--color-foreground"), good: g("--color-success"), ok: g("--color-warning"), bad: g("--color-destructive"), primary: g("--color-primary"), muted: g("--color-muted-foreground"), dark: document.documentElement.dataset.theme !== "light" };
    };
    let col = css();
    const mo = new MutationObserver(() => { col = css(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const rgba = (hex: string, a: number) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    };
    const tone = (t: ScanTone) => (t === "good" ? col.good : t === "ok" ? col.ok : t === "bad" ? col.bad : col.muted);

    let rot = 0.8, tilt = BASE_TILT, zoom = 1, vel = 0, dragging = false, lastX = 0, lastT = 0;
    let sweep = 0, prev = performance.now(), raf = 0;
    let prevMode: ScanMode = live.current.mode;
    let from = { rot, tilt, zoom };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (!visible || document.hidden) return;
      const { mode: m, targets: ts, lockId: lid, home: hm } = live.current;

      // the lock sequence starts when the mode changes to "locked" and a point is named
      const lock = m === "locked" ? ts.find((x) => x.id === lid) ?? null : null;
      if (m !== prevMode) {
        if (m === "locked" && lock) { lockedAt.current = now; from = { rot, tilt, zoom }; }
        else lockedAt.current = null;
        prevMode = m;
      }
      if (m === "locked" && lock && lockedAt.current == null) { lockedAt.current = now; from = { rot, tilt, zoom }; }
      const k = lockedAt.current == null ? 0 : (now - lockedAt.current) / 1000;   // seconds since the lock began

      // motion: free turning, or the turn to the locked point
      if (lock) {
        const e = reduce ? 1 : ease(k / 1.5);
        let target = lock.lon * DEG;
        let d = target - from.rot; d = Math.atan2(Math.sin(d), Math.cos(d));      // the short way round
        rot = from.rot + d * e;
        tilt = from.tilt + (Math.max(-1.1, Math.min(1.1, lock.lat * DEG)) - from.tilt) * e;
        zoom = from.zoom + (1.22 - from.zoom) * e;
      } else {
        tilt += (BASE_TILT - tilt) * Math.min(1, dt * 2.5);
        zoom += (1 - zoom) * Math.min(1, dt * 2.5);
        if (!dragging) {
          if (Math.abs(vel) > 0.00005) { rot += vel * dt * 60; vel *= 0.95; }
          else if (!reduce) rot += (m === "capture" ? 0.1 : m === "idle" ? 0.07 : 0.05) * dt;
        }
      }
      const speed = m === "capture" ? 2.6 : m === "measure" ? 3.4 : m === "wait" ? 1.1 : m === "locked" ? 0.5 : 0.7;
      if (!reduce) sweep += speed * dt;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.43 * zoom, cx = w / 2, cy = h / 2;
      const c = Math.cos(rot), s = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
      const proj = (v: [number, number, number]) => {
        const x = v[0] * c - v[2] * s, z0 = v[2] * c + v[0] * s;
        return { x: cx + x * R, y: cy - (v[1] * ct - z0 * st) * R, z: v[1] * st + z0 * ct };
      };

      // body and rim light
      const halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.28);
      halo.addColorStop(0, rgba(col.primary, col.dark ? 0.2 : 0.14)); halo.addColorStop(1, rgba(col.primary, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.28, 0, Math.PI * 2); ctx.fill();
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      body.addColorStop(0, rgba(col.primary, col.dark ? 0.1 : 0.07)); body.addColorStop(0.7, rgba(col.fg, 0.02)); body.addColorStop(1, rgba(col.primary, col.dark ? 0.12 : 0.08));
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // the grid of latitudes and longitudes
      ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.strokeStyle = rgba(col.primary, lat === 0 ? 0.34 : 0.15); ctx.beginPath();
        let pen = false;
        for (let lon = -180; lon <= 180; lon += 6) { const p = proj(vec(lat, lon)); if (p.z <= 0) { pen = false; continue; } if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; } }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.strokeStyle = rgba(col.primary, lon === 0 ? 0.3 : 0.13); ctx.beginPath();
        let pen = false;
        for (let lat = -90; lat <= 90; lat += 6) { const p = proj(vec(lat, lon)); if (p.z <= 0) { pen = false; continue; } if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; } }
        ctx.stroke();
      }

      // land tiles, lit by the beam as it passes over them
      const tileSize = R * STEP * DEG * 1.05;
      for (const t of tiles) {
        const x = t.x * c - t.z * s, z0 = t.z * c + t.x * s;
        const z = t.y * st + z0 * ct;
        if (z <= 0.02) continue;
        const y = t.y * ct - z0 * st;
        const px = cx + x * R, py = cy - y * R;
        const ang = Math.atan2(py - cy, px - cx);
        let lag = (sweep - ang) % (Math.PI * 2); if (lag < 0) lag += Math.PI * 2;
        const beam = lag < 1.5 ? Math.pow(1 - lag / 1.5, 2) : 0;
        const a = 0.16 + 0.34 * z + beam * 0.55;
        ctx.fillStyle = beam > 0.35 ? rgba("#ffffff", Math.min(0.95, a)) : rgba(col.primary, Math.min(0.95, a));
        const sz = Math.max(1, tileSize * (0.5 + 0.5 * z));
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      }

      // the beam: a wedge that fades behind a bright leading edge
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      if (typeof ctx.createConicGradient === "function") {
        const cg = ctx.createConicGradient(sweep - 1.5, cx, cy);
        cg.addColorStop(0, rgba(col.primary, 0)); cg.addColorStop(1.5 / (Math.PI * 2), rgba(col.primary, m === "locked" ? 0.1 : 0.3)); cg.addColorStop(1.5 / (Math.PI * 2) + 0.0001, rgba(col.primary, 0)); cg.addColorStop(1, rgba(col.primary, 0));
        ctx.fillStyle = cg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      ctx.strokeStyle = rgba(col.primary, m === "locked" ? 0.35 : 0.85); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = rgba(col.primary, 0.5); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      // rings that go out from the middle while the game is captured and measured: the scanner "listens"
      if ((m === "capture" || m === "measure") && !reduce) {
        for (let i = 0; i < 3; i++) {
          const ph = ((now / 1000) * 0.55 + i / 3) % 1;
          ctx.strokeStyle = rgba(col.primary, (1 - ph) * 0.35); ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(cx, cy, R * (0.15 + ph * 0.85), 0, Math.PI * 2); ctx.stroke();
        }
      }

      // the other servers: quiet dots in the colour of their quality
      for (const t of ts) {
        if (t.id === lid && m === "locked") continue;
        const p = proj(vec(t.lat, t.lon));
        if (p.z <= 0.02) continue;
        ctx.fillStyle = rgba(tone(t.tone), 0.95); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(tone(t.tone), 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2); ctx.stroke();
      }
      if (hm) {
        const p = proj(vec(hm.lat, hm.lon));
        if (p.z > 0.02) { ctx.fillStyle = rgba(col.fg, 0.9); ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = rgba(col.fg, 0.45); ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.stroke(); }
      }

      // the lock-on at the exact point
      if (lock) {
        const p = proj(vec(lock.lat, lock.lon));
        const colr = tone(lock.tone === "idle" ? "good" : lock.tone);
        const appear = reduce ? 1 : ease((k - 1.1) / 0.5);
        if (appear > 0) {
          // ripples
          for (let i = 0; i < 3; i++) {
            const ph = (((k - 1.1) * 0.7) + i / 3) % 1;
            ctx.strokeStyle = rgba(colr, (1 - ph) * 0.7 * appear); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(p.x, p.y, 4 + ph * 46, 0, Math.PI * 2); ctx.stroke();
          }
          // the frame closes in on the point
          const gap = 12 + (1 - ease((k - 1.2) / 0.7)) * 46, arm = 11;
          ctx.strokeStyle = rgba(colr, appear); ctx.lineWidth = 2; ctx.lineCap = "round";
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.beginPath(); ctx.moveTo(p.x + sx * gap, p.y + sy * (gap - arm)); ctx.lineTo(p.x + sx * gap, p.y + sy * gap); ctx.lineTo(p.x + sx * (gap - arm), p.y + sy * gap); ctx.stroke();
          }
          ctx.strokeStyle = rgba(colr, 0.45 * appear); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x - gap - 16, p.y); ctx.lineTo(p.x - 7, p.y); ctx.moveTo(p.x + 7, p.y); ctx.lineTo(p.x + gap + 16, p.y);
          ctx.moveTo(p.x, p.y - gap - 16); ctx.lineTo(p.x, p.y - 7); ctx.moveTo(p.x, p.y + 7); ctx.lineTo(p.x, p.y + gap + 16); ctx.stroke();
          // the pin: a beam of light rising from the point, with a bright head
          const rise = ease((k - 1.6) / 0.6) * 54;
          if (rise > 0) {
            const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y - rise);
            g.addColorStop(0, rgba(colr, 0.9)); g.addColorStop(1, rgba(colr, 0.15));
            ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - rise); ctx.stroke();
            const hg = ctx.createRadialGradient(p.x, p.y - rise, 0, p.x, p.y - rise, 12);
            hg.addColorStop(0, rgba("#ffffff", 0.95)); hg.addColorStop(0.35, rgba(colr, 0.9)); hg.addColorStop(1, rgba(colr, 0));
            ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(p.x, p.y - rise, 12, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.fillStyle = rgba("#ffffff", 0.95); ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(colr, 1); ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);

    const down = (e: PointerEvent) => { if (live.current.mode === "locked") return; dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, now = performance.now();
      rot -= dx * 0.006; vel = (-dx * 0.006) / Math.max(1, now - lastT) * 16; lastX = e.clientX; lastT = now;
    };
    const up = () => { dragging = false; };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [tiles]);

  return (
    <div ref={box} className={cn("relative select-none", mode !== "locked" && "cursor-grab active:cursor-grabbing", className)}>
      <canvas ref={cv} role="img" aria-label={label} className="block" />
      {children}
    </div>
  );
}
