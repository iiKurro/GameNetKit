-- GameNetKit group server schema (Cloudflare D1)
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- clients remember the last seq they saw and ask only for newer rows
  player_id  TEXT NOT NULL,
  game       TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  time       TEXT NOT NULL,
  results    TEXT NOT NULL,                        -- JSON array of the servers of that scan
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, game, run_id)
);
