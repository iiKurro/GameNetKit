// GameNetKit group server: a tiny Cloudflare Worker + D1 (SQLite) database.
// Everyone in the group uploads their own scans and downloads everybody's, so each app can show friends' records and compute
// block suggestions from the pooled data. There are no accounts: the group is protected by one shared code (a Worker secret),
// and each player is bound to a random secret chosen by their app the first time they upload (so nobody can post as someone else).
//
//   GET    /                    health check (no code needed)
//   GET    /v1/status           { players, runs }
//   GET    /v1/runs?since=N     scans with seq > N (oldest first, at most 300), { runs, next, more }
//   POST   /v1/runs             { player: { id, name }, runs: [ ... ] }  headers: x-player-secret
//   DELETE /v1/me               removes the caller's scans and player record
// Every call except "/" needs the header  x-group: <group code>.

const MAX_BODY = 256 * 1024;      // bytes of JSON per upload
const MAX_RUNS_PER_POST = 50;
const MAX_RESULTS_PER_RUN = 40;
const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;
const PLAYER_RX = /^[a-f0-9]{6,16}$/;
const VERDICTS = new Set(["good", "ok", "bad", "noreply"]);
const IPV4_RX = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RX = /^[0-9a-fA-F:]{2,45}$/;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      return json({ error: "server error" }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(text) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// compares two secrets without leaking where they differ
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").slice(0, max) : "");
const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : 0);
const numOrNull = (v, hi) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(hi, Math.max(0, Number(v))));

// only the fields the app uses are kept, with their types and sizes enforced
function cleanResult(r) {
  if (!r || typeof r !== "object") return null;
  const ip = str(r.ip, 45);
  if (!IPV4_RX.test(ip) && !IPV6_RX.test(ip)) return null;
  return {
    ip,
    port: int(r.port, 0, 65535),
    country: str(r.country, 60),
    cc: str(r.cc, 2).toUpperCase(),
    city: str(r.city, 60),
    provider: str(r.provider, 80),
    host: str(r.host, 120),
    packets: int(r.packets, 0, 1e9),
    kb: int(r.kb, 0, 1e9),
    avg: numOrNull(r.avg, 5000),
    max: numOrNull(r.max, 5000),
    jitter: numOrNull(r.jitter, 5000),
    loss: int(r.loss, 0, 100),
    verdict: VERDICTS.has(r.verdict) ? r.verdict : "noreply",
  };
}

function cleanRun(r) {
  if (!r || typeof r !== "object" || !ID_RX.test(String(r.id || ""))) return null;
  const game = str(r.game, 40).trim();
  if (!game || !Array.isArray(r.results) || r.results.length === 0 || r.results.length > MAX_RESULTS_PER_RUN) return null;
  const results = r.results.map(cleanResult);
  if (results.some((x) => x === null)) return null;
  return { id: String(r.id), game, time: str(r.time, 20), results };
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") return json({ app: "GameNetKit group server", ok: true });

  // everything else needs the group code
  const code = request.headers.get("x-group") || "";
  if (!env.GROUP_CODE || !code || !(await sameSecret(code, String(env.GROUP_CODE).trim()))) return json({ error: "bad code" }, 401);

  if (url.pathname === "/v1/status" && request.method === "GET") {
    const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM players").first();
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs").first();
    return json({ players: p.n, runs: r.n });
  }

  if (url.pathname === "/v1/runs" && request.method === "GET") {
    const since = int(url.searchParams.get("since"), 0, Number.MAX_SAFE_INTEGER);
    const limit = int(url.searchParams.get("limit") || 300, 1, 300);
    const { results } = await env.DB.prepare(
      "SELECT r.seq, r.player_id, p.name, r.game, r.run_id, r.time, r.results FROM runs r JOIN players p ON p.id = r.player_id WHERE r.seq > ? ORDER BY r.seq LIMIT ?",
    ).bind(since, limit).all();
    const runs = results.map((x) => ({
      seq: x.seq, player: { id: x.player_id, name: x.name }, game: x.game, id: x.run_id, time: x.time, results: JSON.parse(x.results),
    }));
    return json({ runs, next: runs.length ? runs[runs.length - 1].seq : since, more: runs.length === limit });
  }

  if (url.pathname === "/v1/runs" && request.method === "POST") {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "too big" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }

    const id = String(body?.player?.id || "");
    const name = str(body?.player?.name, 24).trim();
    const secret = request.headers.get("x-player-secret") || "";
    if (!PLAYER_RX.test(id) || !name || secret.length < 16 || secret.length > 128) return json({ error: "bad player" }, 400);
    if (!Array.isArray(body.runs) || body.runs.length > MAX_RUNS_PER_POST) return json({ error: "bad runs" }, 400);

    // the first upload of a player id fixes its secret; later calls must present the same one
    const hash = await sha256(secret);
    const row = await env.DB.prepare("SELECT secret_hash, name FROM players WHERE id = ?").bind(id).first();
    if (!row) await env.DB.prepare("INSERT INTO players (id, name, secret_hash, created_at) VALUES (?, ?, ?, ?)").bind(id, name, hash, Date.now()).run();
    else if (row.secret_hash !== hash) return json({ error: "player belongs to someone else" }, 403);
    else if (row.name !== name) await env.DB.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, id).run();

    const clean = body.runs.map(cleanRun).filter(Boolean);
    if (clean.length) {
      await env.DB.batch(clean.map((r) =>
        env.DB.prepare("INSERT OR IGNORE INTO runs (player_id, game, run_id, time, results, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, r.game, r.id, r.time, JSON.stringify(r.results), Date.now()),
      ));
    }
    return json({ ok: true, accepted: clean.length, rejected: body.runs.length - clean.length });
  }

  if (url.pathname === "/v1/me" && request.method === "DELETE") {
    const id = request.headers.get("x-player") || "";
    const secret = request.headers.get("x-player-secret") || "";
    const row = PLAYER_RX.test(id) ? await env.DB.prepare("SELECT secret_hash FROM players WHERE id = ?").bind(id).first() : null;
    if (!row || row.secret_hash !== (await sha256(secret))) return json({ error: "unknown player" }, 403);
    await env.DB.batch([env.DB.prepare("DELETE FROM runs WHERE player_id = ?").bind(id), env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id)]);
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
