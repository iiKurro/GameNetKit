-- Run once on a database created before scans carried the provider name (version 1.1.0 and older):
--   npx wrangler d1 execute gamenetkit --remote --file=migrate-net.sql
ALTER TABLE runs ADD COLUMN net TEXT;
