import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { centreOf, isLand } from "@/lib/geo";

export type GlobeTone = "good" | "ok" | "bad" | "idle";

export interface GlobePoint {
  id: string;
  /** country code of the server */
  cc: string;
  /** what is written beside the marker */
  label: string;
  tone: GlobeTone;
  /** the number shown with the label, e.g. "31 ms" */
  detail?: string;
}

interface Props {
  /** where the player is: arcs start here */
  origin?: { cc: string; label: string } | null;
  points: GlobePoint[];
  /** this point is turned to the front when the globe appears */
  focus?: string;
  className?: string;
  label: string;
}

const DEG = Math.PI / 180;
const TILT = 0.38;             // the pole leans towards the viewer a little, so the northern land shows more
const N_DOTS = 4200;

interface Dot { x: number; y: number; z: number }

// dots on the sphere, evenly spread (a Fibonacci spiral); only the ones that fall on land are kept
function landDots(): Dot[] {
  const out: Dot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N_DOTS; i++) {
    const y = 1 - (2 * (i + 0.5)) / N_DOTS;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    const x = r * Math.cos(th), z = r * Math.sin(th);
    const lat = Math.asin(y) / DEG, lon = Math.atan2(x, z) / DEG;       // x = cos(lat) sin(lon), z = cos(lat) cos(lon)
    if (isLand(lat, lon)) out.push({ x, y, z });
  }
  return out;
}

function vec(lat: number, lon: number): [number, number, number] {
  const c = Math.cos(lat * DEG);
  return [c * Math.sin(lon * DEG), Math.sin(lat * DEG), c * Math.cos(lon * DEG)];
}

function slerp(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(d);
  if (w < 1e-4) return a;
  const s = Math.sin(w), k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

/**
 * A turning globe made of dots (only land), with a glowing arc from the player's country to every server, a light travelling along each arc
 * and a pulse on each place. Names stay hidden until the pointer is on a place (so nothing piles up); drag to turn the globe. It turns slowly
 * by itself while nobody touches it (and stays still when the system asks for less motion).
 */
export function Globe({ origin, points, focus, className, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const dots = useMemo(landDots, []);
  const [hover, setHover] = useState<string | null>(null);
  const live = useRef({ origin, points, hover });
  live.current = { origin, points, hover };

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

    // the turning angle (radians of longitude) starts at the focused place, or at the player
    const startLon = (() => {
      const f = points.find((p) => p.id === focus);
      const c = centreOf(f?.cc) ?? centreOf(origin?.cc) ?? centreOf(points[0]?.cc);
      return c ? c[1] * DEG : 0.6;
    })();
    let rot = startLon, vel = 0, dragging = false, lastX = 0, lastT = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(wrap);

    const css = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (n: string) => s.getPropertyValue(n).trim();
      return { fg: g("--color-foreground"), muted: g("--color-muted-foreground"), good: g("--color-success"), ok: g("--color-warning"), bad: g("--color-destructive"), primary: g("--color-primary"), card: g("--color-card"), dark: document.documentElement.dataset.theme !== "light" };
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
    const toneColor = (t: GlobeTone) => (t === "good" ? col.good : t === "ok" ? col.ok : t === "bad" ? col.bad : col.muted);

    // screen position of a unit vector at the current angle; z > 0 is the side facing the viewer
    const project = (v: [number, number, number], R: number, cx: number, cy: number) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      const x = v[0] * c - v[2] * s, z0 = v[2] * c + v[0] * s;
      const ct = Math.cos(TILT), st = Math.sin(TILT);
      const y = v[1] * ct - z0 * st, z = v[1] * st + z0 * ct;
      return { x: cx + x * R, y: cy - y * R, z };
    };

    let raf = 0, prev = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (!visible || document.hidden) return;
      if (!dragging) {
        if (Math.abs(vel) > 0.00005) { rot += vel * dt * 60; vel *= 0.95; }
        else if (!reduce) rot += 0.12 * dt;
      }

      const { origin: o, points: pts, hover: hv } = live.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.45, cx = w / 2, cy = h / 2 + 4;

      // a very soft atmosphere and body (the glow is only a hint)
      const halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.22);
      halo.addColorStop(0, rgba(col.primary, col.dark ? 0.05 : 0.035)); halo.addColorStop(1, rgba(col.primary, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();
      const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      body.addColorStop(0, rgba(col.fg, col.dark ? 0.035 : 0.03)); body.addColorStop(1, rgba(col.fg, col.dark ? 0.008 : 0.012));
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(col.fg, 0.12); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      // land
      const c = Math.cos(rot), s = Math.sin(rot), ct = Math.cos(TILT), st = Math.sin(TILT);
      for (const d of dots) {
        const x = d.x * c - d.z * s, z0 = d.z * c + d.x * s;
        const z = d.y * st + z0 * ct;
        if (z < -0.02) continue;
        const y = d.y * ct - z0 * st;
        const a = 0.18 + 0.72 * Math.max(0, z);
        ctx.fillStyle = rgba(col.fg, a * (col.dark ? 0.8 : 0.7));
        const r = 0.7 + 0.9 * Math.max(0, z);
        ctx.fillRect(cx + x * R - r / 2, cy - y * R - r / 2, r, r);
      }

      // arcs, lights and pulses
      const home = o ? centreOf(o.cc) : null;
      const a = home ? vec(home[0], home[1]) : null;
      const t = now / 1000;
      const shown: { x: number; y: number; z: number; color: string; text: string; strong: boolean }[] = [];
      pts.forEach((p, i) => {
        const cc = centreOf(p.cc);
        if (!cc) return;
        const b = vec(cc[0], cc[1]);
        const color = toneColor(p.tone);
        if (a) {
          const ang = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
          if (ang > 0.02) {
            const lift = 0.05 + 0.2 * (ang / Math.PI);
            const steps = 56;
            ctx.lineWidth = 1.3;
            let last: { x: number; y: number; z: number } | null = null;
            for (let k = 0; k <= steps; k++) {
              const u = k / steps;
              const v = slerp(a, b, u);
              const k2 = 1 + lift * Math.sin(Math.PI * u);
              const q = project([v[0] * k2, v[1] * k2, v[2] * k2], R, cx, cy);
              if (last && q.z > 0 && last.z > 0) {
                ctx.strokeStyle = rgba(color, 0.12 + 0.45 * u);
                ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke();
              }
              last = q;
            }
            // the light that travels from the player to the server
            const u = ((t * 0.32 + i * 0.37) % 1 + 1) % 1;
            const v = slerp(a, b, u), k2 = 1 + lift * Math.sin(Math.PI * u);
            const q = project([v[0] * k2, v[1] * k2, v[2] * k2], R, cx, cy);
            if (q.z > 0) {
              const gl = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 8);
              gl.addColorStop(0, rgba(color, 0.9)); gl.addColorStop(1, rgba(color, 0));
              ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = rgba("#ffffff", 0.95); ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        const q = project(b, R, cx, cy);
        // a number keeps its own order inside an Arabic line (the isolates), so "31 ms" never turns into "ms 31"
        if (q.z > -0.05) shown.push({ ...q, color, text: p.detail ? `⁨${p.label}⁩ · ⁦${p.detail}⁩` : p.label, strong: p.id === hv });
      });
      if (a) {
        const q = project(a, R, cx, cy);
        if (q.z > -0.05) shown.push({ ...q, color: col.primary, text: o?.label ?? "", strong: true });
      }

      for (const m of shown) {
        const front = m.z > 0;
        const al = front ? 1 : 0.35;
        const ph = (t * 0.9 + m.x * 0.01) % 1;
        ctx.strokeStyle = rgba(m.color, (1 - ph) * 0.55 * al); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(m.x, m.y, 3 + ph * 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = rgba(m.color, al); ctx.beginPath(); ctx.arc(m.x, m.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba("#ffffff", 0.9 * al); ctx.beginPath(); ctx.arc(m.x, m.y, 1.1, 0, Math.PI * 2); ctx.fill();
      }

      // names stay out of the way: the player's place, the marker under the pointer, and a few others only if there is room
      ctx.font = `600 11px "Cairo Variable", "Segoe UI", sans-serif`;
      ctx.textBaseline = "middle";
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const order = shown.filter((m) => m.z > 0.15 && m.text).sort((a2, b2) => Number(b2.strong) - Number(a2.strong));
      for (const m of order) {
        if (!m.strong && order.length > 4) continue;
        const wText = ctx.measureText(m.text).width;
        const right = m.x + 12 + wText + 10 < w;
        const tx = right ? m.x + 12 : m.x - 12 - wText;
        const slot = { x: tx - 6, y: m.y - 10, w: wText + 12, h: 20 };
        if (placed.some((q) => slot.x < q.x + q.w && slot.x + slot.w > q.x && slot.y < q.y + q.h && slot.y + slot.h > q.y)) continue;
        placed.push(slot);
        ctx.fillStyle = rgba(col.card, 0.84);
        ctx.beginPath(); ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 6); ctx.fill();
        ctx.fillStyle = col.fg; ctx.textAlign = "left"; ctx.fillText(m.text, tx, m.y + 0.5);
      }
    };
    raf = requestAnimationFrame(frame);

    // turning by hand
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - lastX, now = performance.now();
        rot -= dx * 0.006; vel = (-dx * 0.006) / Math.max(1, now - lastT) * 16; lastX = e.clientX; lastT = now;
        return;
      }
      // the marker under the pointer shows its name
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const R = Math.min(w, h) * 0.45, cx = w / 2, cy = h / 2 + 4;
      let best: string | null = null, bd = 18;
      for (const p of live.current.points) {
        const cc = centreOf(p.cc);
        if (!cc) continue;
        const q = project(vec(cc[0], cc[1]), R, cx, cy);
        const d = Math.hypot(q.x - px, q.y - py);
        if (q.z > 0 && d < bd) { bd = d; best = p.id; }
      }
      setHover(best);
    };
    const up = () => { dragging = false; };
    const leave = () => setHover(null);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
    };
    // the globe is rebuilt only when it is shown again; the points are read live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, focus]);

  return (
    <div ref={box} className={cn("relative cursor-grab touch-pan-y select-none active:cursor-grabbing", className)}>
      <canvas ref={cv} role="img" aria-label={label} className="block" />
      <ul className="sr-only">
        {origin && <li>{origin.label}</li>}
        {points.map((p) => <li key={p.id}>{p.label}{p.detail ? ` ${p.detail}` : ""}</li>)}
      </ul>
    </div>
  );
}
