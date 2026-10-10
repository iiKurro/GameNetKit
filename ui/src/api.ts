export interface Game {
  name: string;
  /** the folder-safe name the pictures of the game are asked for by */
  slug?: string;
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
  /** the game keeps one TCP connection to its server (an MMO): no packets were read, and the UDP block does not apply */
  tcp?: boolean;
  avg: number | null;
  max: number | null;
  jitter: number | null;
  loss: number;
  verdict: "good" | "ok" | "bad" | "noreply";
  /** set when the server does not answer ping and the numbers were measured through its cloud region: "gcp:europe-west1", "aws:eu-west-1" */
  via?: string;
  /** where the server is (a point in its city), when the lookup said so; scans saved before that have only the country */
  lat?: number | null;
  lon?: number | null;
}

export interface AdminRun {
  id: string;
  game: string;
  time: string;
  best: { ip: string; country?: string; city?: string; avg: number | null; verdict: string } | null;
}

export interface AdminPlayer {
  id: string;
  name: string;
  total: number;
  /** the admin reset this account: the next login with its name chooses a new password */
  reset?: boolean;
  games: { game: string; count: number; last: string }[];
}

/** a running program that could be the game */
export interface ProcessRow {
  name: string;
  title: string;
  mb: number;
  udp: number;
  suggested: boolean;
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

/** who uses this copy: a name you choose plus a random id (no account) */
export interface Profile {
  name: string;
  id: string;
  /** the Windows user name, offered as the default */
  suggested: string;
  dataDir: string;
}

/** a friend of the group; their scans arrive automatically and are kept apart from mine */
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
  /** a Windows notification when a scan starts capturing and when it is done (only while the app is not the active window) */
  notify: boolean;
  sound: boolean;
  taskInstalled: boolean;
  /** the Startup apps entry was switched off by the user in Task Manager */
  startupDisabled?: boolean;
  /** the in-game panel: its shortcut, its corner (tl / tr / bl / br) and whether it is showing */
  overlayKey: string;
  overlayCorner: "tl" | "tr" | "bl" | "br";
  overlayVisible: boolean;
  /** games kept to Middle East servers while they run (only the true ones are listed) */
  regionLock?: Record<string, boolean>;
}

/** automatic sharing with the group server */
export interface SyncState {
  /** the app knows a server address (otherwise the sharing UI stays hidden) */
  configured: boolean;
  hasCode: boolean;
  enabled: boolean;
  /** "", "code" (wrong group code), "player" (password does not match), "taken" (name belongs to another account), "full", "net" (no connection), "server" */
  error: string;
  lastOkSecondsAgo: number;
  /** players known to the server (everyone who ever uploaded) */
  players: number;
  uploaded: number;
  busy: boolean;
  /** this PC has the group admin code unlocked */
  admin?: boolean;
  /** the account has a password (can be logged into from any PC) */
  hasPassword?: boolean;
}

export interface GuardState {
  running: boolean;
  /** version of the running guard (can lag behind the app after an update when it was installed for start-up) */
  version?: string;
  /** games running right now */
  games: string[];
  /** targets the guard has switched on right now */
  applied: string[];
  /** games whose region lock is switched on at this moment */
  regionLocked?: string[];
}

export interface RunSummary {
  id: string;
  time: string;
  game: string;
  count: number;
  best: ServerResult | null;
  /** the player's provider and country when the scan was made */
  net?: { isp: string; country: string; lat?: number; lon?: number } | null;
}

export interface Run {
  id: string;
  time: string;
  game: string;
  results: ServerResult[];
  net?: { isp: string; country: string; lat?: number; lon?: number } | null;
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
  "/api/blocks": 60000, "/api/blocks/sync": 90000, "/api/account/start": 60000, "/api/account/password": 60000, "/api/admin/reset": 40000, "/api/admin/unlock": 40000, "/api/admin/players": 40000, "/api/admin/delete": 40000,
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
  /** account = name + password: first run (restores the account when the name and password already exist on the server) */
  accountStart: (name: string, password: string, code: string) => call<{ ok: boolean; restored?: boolean; error?: string }>("/api/account/start", { name, password, code }),
  accountPassword: (password: string) => call<{ ok: boolean; error?: string }>("/api/account/password", { password }),
  processes: () => call<ProcessRow[]>("/api/processes"),
  addProcess: (game: string, process: string) => call<{ ok: boolean; error?: string }>("/api/games/process", { game, process }),
  notify: (title: string, text: string) => call<{ ok: boolean }>("/api/notify", { title, text }),
  trayLabels: (l: { open: string; guardOn: string; guardOff: string; exit: string } & Record<string, string>) => call<{ ok: boolean }>("/api/tray/labels", l),
  diagnostics: () => call<{ ok: boolean; text: string }>("/api/diagnostics"),
  syncNow: () => call<{ ok: boolean }>("/api/sync/now", {}),
  /** group admin (hidden, Ctrl+Shift+A): only works with the admin code */
  adminUnlock: (code: string) => call<{ ok: boolean; error?: string }>("/api/admin/unlock", { code }),
  adminReset: (player: string) => call<{ ok: boolean; error?: string }>("/api/admin/reset", { player }),
  adminLock: () => call<{ ok: boolean }>("/api/admin/lock", {}),
  adminPlayers: () => call<{ players?: AdminPlayer[]; ok?: boolean; error?: string }>("/api/admin/players"),
  adminRuns: (player: string) => call<{ runs?: AdminRun[]; ok?: boolean; error?: string }>("/api/admin/runs", { player }),
  adminDelete: (player: string, game = "", run = "") => call<{ ok: boolean; removed?: number; error?: string }>("/api/admin/delete", { player, game, run }),
  guardUpdate: () => call<{ ok: boolean; error?: string; detail?: string }>("/api/guard/update", {}),
  settings: () => call<Settings>("/api/settings"),
  settingsSet: (patch: Partial<Pick<Settings, "guardAuto" | "background" | "startup" | "notify" | "sound" | "overlayKey" | "overlayCorner" | "overlayVisible" | "regionLock">>) =>
    call<Settings & { ok?: boolean; error?: string; detail?: string }>("/api/settings/set", patch),
  unblock: (ip: string) => call<{ ok: boolean; error?: string; detail?: string }>("/api/unblock", { ip }),
  // history is always per game: scans of different games are never mixed
  // person = slug of a friend of the group ("" = my own scans)
  history: (game: string, person = "") => call<RunSummary[]>("/api/history", { game, person }),
  historyCounts: () => call<Record<string, number>>("/api/history/counts"),
  historyGet: (game: string, id: string, person = "") => call<Run>("/api/history/get", { game, id, person }),
  historyDelete: (game: string, id: string, person = "") => call<{ ok: boolean }>("/api/history/delete", { game, id, person }),
  historyClear: (game: string, person = "") => call<{ ok: boolean }>("/api/history/clear", { game, person }),
  profile: () => call<Profile>("/api/profile"),
  profileSet: (name: string) => call<Profile & { ok?: boolean; error?: string }>("/api/profile/set", { name }),
  people: () => call<Person[]>("/api/people"),
  peopleDelete: (slug: string) => call<{ ok: boolean }>("/api/people/delete", { slug }),
  blocksSync: () => call<BlockEntry[]>("/api/blocks/sync", {}),
  unblockAll: () => call<{ ok: boolean; error?: string; detail?: string }>("/api/unblockall", {}),
};
