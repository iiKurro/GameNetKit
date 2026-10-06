-- One-off migration for a database created before accounts had passwords (version 1.0.4 and older): run once with
--   npx wrangler d1 execute gamenetkit --remote --file=migrate-accounts.sql
ALTER TABLE players ADD COLUMN name_key TEXT;
UPDATE players SET name_key = lower(trim(name)) WHERE name_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (name_key);
CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL);
