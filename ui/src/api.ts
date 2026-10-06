export interface Game {
  name: string;
  process: string;
  enabled: boolean;
}

export interface Info {
  version: string;
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

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = (window as unknown as { __TOKEN__?: string }).__TOKEN__ ?? "";
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? { "X-Token": token } : { "Content-Type": "application/json", "X-Token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  info: () => call<Info>("/api/info"),
  state: () => call<State>("/api/state"),
  start: (game: string) => call<{ ok: boolean; error?: string }>("/api/start", { game }),
  begin: () => call<{ ok: boolean }>("/api/begin", {}),
  cancel: () => call<{ ok: boolean }>("/api/cancel", {}),
  reset: () => call<{ ok: boolean }>("/api/reset", {}),
  openFolder: () => call<{ ok: boolean }>("/api/openfolder", {}),
  checkUpdate: () => call<UpdateInfo>("/api/update/check"),
  applyUpdate: () => call<{ ok: boolean; error?: string }>("/api/update/apply", {}),
  heartbeat: () => call<{ ok: boolean }>("/api/heartbeat", {}),
  blocks: () => call<BlockEntry[]>("/api/blocks"),
  block: (ip: string, label: string, game: string) => call<{ ok: boolean; error?: string }>("/api/block", { ip, label, game }),
  unblock: (ip: string) => call<{ ok: boolean; error?: string }>("/api/unblock", { ip }),
  history: () => call<RunSummary[]>("/api/history"),
  historyGet: (id: string) => call<Run>("/api/history/get", { id }),
  historyDelete: (id: string) => call<{ ok: boolean }>("/api/history/delete", { id }),
  historyClear: () => call<{ ok: boolean }>("/api/history/clear", {}),
};
