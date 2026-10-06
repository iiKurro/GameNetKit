// GameNetKit group server: a tiny Cloudflare Worker + D1 (SQLite) database.
// Everyone in the group uploads their own scans and downloads everybody's, so each app can show friends' records and compute
// block suggestions from the pooled data. There are no accounts: the group is protected by one shared code (a Worker secret),
// and each player is bound to a random secret chosen by their app the first time they upload (so nobody can post as someone else).
// Limits: 60 players, 4000 scans per player, 256 KB per upload.
//
//   GET    /                    health check (no code needed)
//   GET    /v1/status           { players, runs }
//   GET    /v1/runs?since=N     scans with seq > N (oldest first, at most 300), { runs, next, more }
//   POST   /v1/runs             { player: { id, name }, runs: [ ... ] }  headers: x-player-secret
//   GET    /v1/admin/players    (header x-admin) every player with scan counts per game
//   GET    /v1/admin/runs?player=ID   (header x-admin) the scans of one player, newest first
//   POST   /v1/admin/delete     (header x-admin) { player, game?, run? } removes one scan, one game's scans, or everything (and the player)
// Every call except "/" needs the header  x-group: <group code>.

const MAX_BODY = 256 * 1024;      // bytes of JSON per upload
const MAX_RUNS_PER_POST = 50;
const MAX_RESULTS_PER_RUN = 40;
const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;
const PLAYER_RX = /^[a-f0-9]{6,16}$/;
const VERDICTS = new Set(["good", "ok", "bad", "noreply"]);
const MAX_PLAYERS = 60;
const MAX_RUNS_PER_PLAYER = 4000;
const IPV4_RX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_RX = /^(?=.*:)[0-9a-fA-F:]{3,45}$/;

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

// control characters, bidi overrides / zero-width marks and markup characters are dropped from every text field
// "Salem", "salem " and "SALEM" are the same account name
const nameKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, " ");

const str = (v, max) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}<>&]/gu, "").slice(0, max) : "");
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
    via: str(r.via, 40),   // "gcp:europe-west1" / "aws:eu-west-1" when the ping was measured through the cloud region
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
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "too big" }, 413);
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "too big" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }

    const id = String(body?.player?.id || "");
    const name = str(body?.player?.name, 24).trim();
    const secret = request.headers.get("x-player-secret") || "";
    const upgrade = request.headers.get("x-player-upgrade") || "";
    if (!PLAYER_RX.test(id) || !name || secret.length < 16 || secret.length > 128) return json({ error: "bad player" }, 400);
    if (!Array.isArray(body.runs) || body.runs.length > MAX_RUNS_PER_POST) return json({ error: "bad runs" }, 400);

    // The first upload of a player id fixes its secret (a random one chosen by that app); later calls must present the same one.
    // Players registered by version 1.0.0 have a secret derived from the group code: they prove it once with x-player-upgrade
    // and the stored secret is replaced by the new random one.
    const hash = await sha256(secret);
    const row = await env.DB.prepare("SELECT secret_hash, name FROM players WHERE id = ?").bind(id).first();
    if (!row) {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM players").first();
      if (n.n >= MAX_PLAYERS) return json({ error: "group is full" }, 429);
      // one account per name (the name is part of the login), and a name is never changed afterwards
      const key = nameKey(name);
      const taken = await env.DB.prepare("SELECT id FROM players WHERE name_key = ?").bind(key).first();
      if (taken) return json({ error: "name taken" }, 409);
      await env.DB.prepare("INSERT INTO players (id, name, name_key, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, name, key, hash, Date.now()).run();
    } else if (row.secret_hash !== hash) {
      // players of 1.0.0 proved themselves with a secret derived from the group code: they may swap it once for a new one
      if (upgrade.length >= 16 && upgrade.length <= 128 && row.secret_hash === (await sha256(upgrade))) {
        await env.DB.prepare("UPDATE players SET secret_hash = ? WHERE id = ?").bind(hash, id).run();
      } else return json({ error: "player belongs to someone else" }, 403);
    }

    const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE player_id = ?").bind(id).first();
    if (have.n >= MAX_RUNS_PER_PLAYER) return json({ error: "too many scans" }, 429);

    const clean = body.runs.map(cleanRun).filter(Boolean);
    if (clean.length) {
      await env.DB.batch(clean.map((r) =>
        env.DB.prepare("INSERT OR IGNORE INTO runs (player_id, game, run_id, time, results, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, r.game, r.id, r.time, JSON.stringify(r.results), Date.now()),
      ));
    }
    return json({ ok: true, accepted: clean.length, rejected: body.runs.length - clean.length });
  }

  // ---- accounts: the name plus the player's password (turned into a secret by the app) is the login.
  // POST /v1/login    body { name }, header x-player-secret  ->  { exists:false } | { exists:true, id }  (403 wrong password, 429 too many tries)
  // POST /v1/password headers x-player (id), x-player-secret (current), x-new-secret  ->  sets the new secret (404 unknown id, 403 wrong)
  if (url.pathname === "/v1/login" && request.method === "POST") {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return json({ error: "bad json" }, 400); }
    const name = str(body?.name, 24).trim();
    const secret = request.headers.get("x-player-secret") || "";
    if (!name || secret.length < 16 || secret.length > 128) return json({ error: "bad login" }, 400);
    const key = nameKey(name);
    const now = Date.now();
    const f = await env.DB.prepare("SELECT n, t FROM fails WHERE k = ?").bind(key).first();
    if (f && f.n >= 8 && now - f.t < 10 * 60 * 1000) return json({ error: "too many tries" }, 429);
    const row = await env.DB.prepare("SELECT id, secret_hash FROM players WHERE name_key = ?").bind(key).first();
    if (!row) return json({ ok: true, exists: false });
    const hash = await sha256(secret);
    if (row.secret_hash === "") {
      // the admin reset this account: the next person to log in with the name chooses the password
      await env.DB.prepare("UPDATE players SET secret_hash = ? WHERE id = ?").bind(hash, row.id).run();
      return json({ ok: true, exists: true, id: row.id, claimed: true });
    }
    if (row.secret_hash !== hash) {
      const keep = f && now - f.t < 10 * 60 * 1000 ? f.n + 1 : 1;
      await env.DB.prepare("INSERT INTO fails (k, n, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = excluded.n, t = excluded.t").bind(key, keep, now).run();
      return json({ error: "wrong password" }, 403);
    }
    await env.DB.prepare("DELETE FROM fails WHERE k = ?").bind(key).run();
    return json({ ok: true, exists: true, id: row.id });
  }

  if (url.pathname === "/v1/password" && request.method === "POST") {
    const id = request.headers.get("x-player") || "";
    const secret = request.headers.get("x-player-secret") || "";
    const next = request.headers.get("x-new-secret") || "";
    if (!PLAYER_RX.test(id) || next.length < 16 || next.length > 128) return json({ error: "bad request" }, 400);
    const row = await env.DB.prepare("SELECT secret_hash FROM players WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "unknown player" }, 404);
    const upgrade = request.headers.get("x-player-upgrade") || "";
    const proven = row.secret_hash === (await sha256(secret)) || (upgrade.length >= 16 && row.secret_hash === (await sha256(upgrade)));
    if (!proven) return json({ error: "wrong secret" }, 403);
    await env.DB.prepare("UPDATE players SET secret_hash = ? WHERE id = ?").bind(await sha256(next), id).run();
    return json({ ok: true });
  }

  // ---- group admin (the person who owns the ADMIN_CODE secret): see every player and remove scans. Nobody else can delete anything.
  if (url.pathname.startsWith("/v1/admin/")) {
    const adminCode = request.headers.get("x-admin") || "";
    if (!env.ADMIN_CODE || !adminCode || !(await sameSecret(adminCode, String(env.ADMIN_CODE).trim()))) return json({ error: "not admin" }, 403);

    if (url.pathname === "/v1/admin/players" && request.method === "GET") {
      const players = (await env.DB.prepare("SELECT id, name, created_at, secret_hash FROM players ORDER BY created_at").all()).results;
      const perGame = (await env.DB.prepare("SELECT player_id, game, COUNT(*) AS n, MAX(time) AS last FROM runs GROUP BY player_id, game").all()).results;
      return json({
        players: players.map((p) => {
          const games = perGame.filter((g) => g.player_id === p.id).map((g) => ({ game: g.game, count: g.n, last: g.last }));
          return { id: p.id, name: p.name, created: p.created_at, reset: p.secret_hash === "", total: games.reduce((a, g) => a + g.count, 0), games };
        }),
      });
    }

    if (url.pathname === "/v1/admin/runs" && request.method === "GET") {
      const id = url.searchParams.get("player") || "";
      if (!PLAYER_RX.test(id)) return json({ error: "bad player" }, 400);
      const rows = (await env.DB.prepare("SELECT run_id, game, time, results FROM runs WHERE player_id = ? ORDER BY seq DESC LIMIT 500").bind(id).all()).results;
      return json({
        runs: rows.map((r) => {
          let best = null;
          try { const b = JSON.parse(r.results)[0]; best = b && { ip: b.ip, country: b.country, city: b.city, avg: b.avg, verdict: b.verdict }; } catch { /* unreadable row: listed without details */ }
          return { id: r.run_id, game: r.game, time: r.time, best };
        }),
      });
    }

    if (url.pathname === "/v1/admin/reset" && request.method === "POST") {
      let body;
      try { body = JSON.parse(await request.text()); } catch { return json({ error: "bad json" }, 400); }
      const id = String(body?.player || "");
      if (!PLAYER_RX.test(id)) return json({ error: "bad player" }, 400);
      await env.DB.prepare("UPDATE players SET secret_hash = '' WHERE id = ?").bind(id).run();
      // also forget earlier wrong tries, so the owner is not locked out of choosing the new password
      await env.DB.prepare("DELETE FROM fails WHERE k = (SELECT name_key FROM players WHERE id = ?)").bind(id).run();
      return json({ ok: true });
    }

    if (url.pathname === "/v1/admin/delete" && request.method === "POST") {
      let body;
      try { body = JSON.parse(await request.text()); } catch { return json({ error: "bad json" }, 400); }
      const id = String(body?.player || "");
      if (!PLAYER_RX.test(id)) return json({ error: "bad player" }, 400);
      const game = typeof body?.game === "string" ? body.game : "";
      const run = typeof body?.run === "string" ? body.run : "";
      if (run) {
        // one scan
        if (!ID_RX.test(run)) return json({ error: "bad run" }, 400);
        const one = await env.DB.prepare("DELETE FROM runs WHERE player_id = ? AND run_id = ?" + (game ? " AND game = ?" : "")).bind(...(game ? [id, run, game] : [id, run])).run();
        return json({ ok: true, removed: one.meta?.changes ?? 0 });
      }
      const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE player_id = ?" + (game ? " AND game = ?" : "")).bind(...(game ? [id, game] : [id])).first();
      // one game: only its scans go; everything: the scans and the player record (a returning player registers again by uploading)
      const stmts = game
        ? [env.DB.prepare("DELETE FROM runs WHERE player_id = ? AND game = ?").bind(id, game)]
        : [env.DB.prepare("DELETE FROM runs WHERE player_id = ?").bind(id), env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id)];
      await env.DB.batch(stmts);
      return json({ ok: true, removed: before.n });
    }
    return json({ error: "not found" }, 404);
  }
  return json({ error: "not found" }, 404);
}
