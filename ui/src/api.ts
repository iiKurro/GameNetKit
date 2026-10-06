export interface Game {
  name: string;
  process: string;
  enabled: boolean;
}

export interface Info {
  version: string;
  /** where this PC keeps its files (history, blocks, profile) */
  dataDir: string;
  games: Game[];
  repo: string;
}

export type Phase =
  | "idle"
  | "elevating"
  | "waiting_game"
  | "ready"
  | "capturing"
  | "analyzing"
  | "measuring"
  | "done"
  | "error";

export interface ServerResult {
  ip: string;
  port: number;
  country: string;
  /** ISO country code, when the lookup returned one (older saved scans only have the name) */
  cc?: string;
  city: string;
  provider: string;
  host: string;
  packets: number;
  kb: number;
  avg: number | null;
  max: number | null;
  jitter: number | null;
  loss: number;
  verdict: "good" | "ok" | "bad" | "noreply";
}

export interface BlockEntry {
  ip: string;
  label: string;
  game: string;
  time: string;
  /** how it is blocked: a firewall rule, or a network route when the firewall refuses rules */
  method?: "firewall" | "route";
  /** "game": active only while that game runs (the guard switches it); default "always" */
  mode?: "always" | "game";
}

/** who uses this copy: a name you choose plus a random id (no server, no sign-in) */
export interface Profile {
  name: string;
  id: string;
  /** the Windows user name, offered as the default */
  suggested: string;
  dataDir: string;
}

/** a friend whose export file was imported; their scans are kept apart from mine */
export interface Person {
  slug: string;
  name: string;
  id: string;
  importedAt: string;
  counts: Record<string, number>;
  total: number;
}

export interface Settings {
  /** the guard starts by itself when the app opens (follows what you last chose) */
  guardAuto: boolean;
  /** closing the window keeps the guard running */
  background: boolean;
  /** a sign-in task starts the guard silently, no admin prompt */
  startup: boolean;
  taskInstalled: boolean;
}

/** automatic sharing with the group server */
export interface SyncState {
  /** the app knows a server address (otherwise the sharing UI stays hidden) */
  configured: boolean;
  hasCode: boolean;
  enabled: boolean;
  /** "", "code" (wrong group code), "player", "net" (no connection), "server" */
  error: string;
  lastOkSecondsAgo: number;
  /** players known to the server (everyone who ever uploaded) */
  players: number;
  uploaded: number;
  busy: boolean;
}

export interface GuardState {
  running: boolean;
  /** version of the running guard (can lag behind the app after an update when it was installed for start-up) */
  version?: string;
  /** games running right now */
  games: string[];
  /** targets the guard has switched on right now */
  applied: string[];
}

export interface RunSummary {
  id: string;
  time: string;
  game: string;
  count: number;
  best: ServerResult | null;
}

export interface Run {
  id: string;
  time: string;
  game: string;
  results: ServerResult[];
}

export interface State {
  phase: Phase;
  game: string;
  secondsLeft: number;
  totalSeconds: number;
  ports: number;
  error: string;
  errorCode: string;
  results: ServerResult[];
  csvPath: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  notes: string;
  error: string;
}

/** calls that legitimately take longer (an admin prompt, a download, PowerShell) get a longer limit; everything else 20 s */
const SLOW: Record<string, number> = {
  "/api/block": 120000, "/api/unblock": 120000, "/api/unblockall": 120000,
  "/api/guard/start": 60000, "/api/guard/stop": 30000, "/api/guard/update": 180000, "/api/settings/set": 180000,
  "/api/update/check": 30000, "/api/update/apply": 180000,
  "/api/blocks": 60000, "/api/blocks/sync": 90000,
  "/api/people/import": 90000, "/api/history/export": 60000, "/api/history/exportall": 60000,
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = (window as unknown as { __TOKEN__?: string }).__TOKEN__ ?? "";
  // no request may wait forever: a stuck call would leave a button spinning for good
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SLOW[path] ?? 20000);
  try {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { "X-Token": token } : { "Content-Type": "application/json", "X-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  info: () => call<Info>("/api/info"),
  state: () => call<State>("/api/state"),
  start: (game: string) => call<{ ok: boolean; error?: string }>("/api/start", { game }),
  begin: () => call<{ ok: boolean }>("/api/begin", {}),
  cancel: () => call<{ ok: boolean }>("/api/cancel", {}),
  reset: () => call<{ ok: boolean }>("/api/reset", {}),
  openFolder: (game: string) => call<{ ok: boolean }>("/api/openfolder", { game }),
  checkUpdate: () => call<UpdateInfo>("/api/update/check"),
  applyUpdate: () => call<{ ok: boolean; error?: string }>("/api/update/apply", {}),
  heartbeat: () => call<{ ok: boolean }>("/api/heartbeat", {}),
  blocks: () => call<BlockEntry[]>("/api/blocks"),
  block: (ip: string, label: string, game: string, mode: "always" | "game" = "always") =>
    call<{ ok: boolean; error?: string; detail?: string }>("/api/block", { ip, label, game, mode }),
  guard: () => call<GuardState>("/api/guard"),
  guardStart: () => call<{ ok: boolean; error?: string }>("/api/guard/start", {}),
  guardStop: () => call<{ ok: boolean }>("/api/guard/stop", {}),
  syncState: () => call<SyncState>("/api/sync/state"),
  syncConfig: (patch: { code?: string; enabled?: boolean }) => call<SyncState & { ok?: boolean; error?: string }>("/api/sync/config", patch),
  syncNow: () => call<{ ok: boolean }>("/api/sync/now", {}),
  guardUpdate: () => call<{ ok: boolean; error?: string; detail?: string }>("/api/guard/update", {}),
  settings: () => call<Settings>("/api/settings"),
  settingsSet: (patch: Partial<Pick<Settings, "guardAuto" | "background" | "startup">>) =>
    call<Settings & { ok?: boolean; error?: string; detail?: string }>("/api/settings/set", patch),
  unblock: (ip: string) => call<{ ok: boolean; error?: string; detail?: string }>("/api/unblock", { ip }),
  // history is always per game: scans of different games are never mixed
  // person = slug of an imported friend ("" = my own scans)
  history: (game: string, person = "") => call<RunSummary[]>("/api/history", { game, person }),
  historyCounts: () => call<Record<string, number>>("/api/history/counts"),
  historyGet: (game: string, id: string, person = "") => call<Run>("/api/history/get", { game, id, person }),
  historyDelete: (game: string, id: string, person = "") => call<{ ok: boolean }>("/api/history/delete", { game, id, person }),
  historyClear: (game: string, person = "") => call<{ ok: boolean }>("/api/history/clear", { game, person }),
  historyExport: (game: string) => call<{ ok: boolean; path: string; count: number }>("/api/history/export", { game }),
  historyExportAll: () => call<{ ok: boolean; path: string; count: number; games: number; error?: string }>("/api/history/exportall", {}),
  profile: () => call<Profile>("/api/profile"),
  profileSet: (name: string) => call<Profile & { ok?: boolean; error?: string }>("/api/profile/set", { name }),
  people: () => call<Person[]>("/api/people"),
  peopleImport: (content: string) => call<{ ok: boolean; name?: string; runs?: number; slug?: string; error?: string }>("/api/people/import", { content }),
  peopleDelete: (slug: string) => call<{ ok: boolean }>("/api/people/delete", { slug }),
  openData: () => call<{ ok: boolean }>("/api/opendata", {}),
  blocksSync: () => call<BlockEntry[]>("/api/blocks/sync", {}),
  unblockAll: () => call<{ ok: boolean; error?: string; detail?: string }>("/api/unblockall", {}),
};
