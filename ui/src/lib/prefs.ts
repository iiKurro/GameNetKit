// Per-viewer preferences kept in the browser: colour theme (dark is the default) and density. Storage can be unavailable, so
// every read and write is guarded; the page works without it.
export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function loadTheme(): Theme { return read("theme") === "light" ? "light" : "dark"; }
export function loadDensity(): Density { return read("density") === "compact" ? "compact" : "comfortable"; }

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  write("theme", t);
}
export function applyDensity(d: Density) {
  document.documentElement.dataset.density = d;
  write("density", d);
}
