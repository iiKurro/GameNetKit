// Country flags as inline SVG (Windows has no flag emoji). Older saved scans only have the country name,
// so a name -> code table is built once from the browser's own region names.
import * as flagModule from "country-flag-icons/string/3x2";
import { cn } from "@/lib/utils";

const FLAGS = flagModule as unknown as Record<string, string>;

let byName: Map<string, string> | null = null;

function names(): Map<string, string> {
  if (byName) return byName;
  const m = new Map<string, string>();
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of Object.keys(FLAGS)) {
      if (code.length !== 2) continue;
      const n = dn.of(code);
      if (n) m.set(n.toLowerCase(), code);
    }
  } catch { /* old engine: flags fall back to nothing */ }
  byName = m;
  return m;
}

export function flagCode(country?: string, cc?: string): string | null {
  const code = rawCode(country, cc);
  return code === "IL" ? "PS" : code;       // scans saved before the change still carry the old code
}

function rawCode(country?: string, cc?: string): string | null {
  if (cc && FLAGS[cc.toUpperCase()]) return cc.toUpperCase();
  if (!country) return null;
  return names().get(country.toLowerCase()) ?? null;
}

export function Flag({ country, cc, className }: { country?: string; cc?: string; className?: string }) {
  const code = flagCode(country, cc);
  if (!code) return null;
  return (
    <span
      role="img"
      aria-label={code === "PS" ? "Palestine" : country}
      title={code === "PS" ? "Palestine" : country}
      className={cn("inline-block h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] align-middle ring-1 ring-border [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: FLAGS[code] }}
    />
  );
}
