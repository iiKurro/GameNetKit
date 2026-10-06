-- GameNetKit group server schema (Cloudflare D1)
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT,                                -- the name in lower case: one account per name
  secret_hash TEXT NOT NULL,                       -- hash of the account secret derived from the player's password ('' = reset by the admin)
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (name_key);

-- failed password attempts (to slow down guessing)
CREATE TABLE IF NOT EXISTS fails (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  t INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- clients remember the last seq they saw and ask only for newer rows
  player_id  TEXT NOT NULL,
  game       TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  time       TEXT NOT NULL,
  results    TEXT NOT NULL,                        -- JSON array of the servers of that scan
  net        TEXT,                                 -- JSON { isp, country } of the player's connection when the scan was made
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, game, run_id)
);
