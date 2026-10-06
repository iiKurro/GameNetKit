# GameNetKit group server

A tiny Cloudflare Worker + D1 database. Everybody in the group uploads their own scans and downloads everybody's, so every
copy of GameNetKit can show friends' records and build block suggestions from the pooled data.

- **No accounts, no sign-in.** The group is protected by one shared **group code** (a Worker secret named `GROUP_CODE`).
  Without the code the server answers 401 to everything except `GET /`.
- Each player is a random id; the first upload of an id fixes its secret (derived by the app from the group code and the id),
  so one player cannot post as another.
- Uploads are validated and cleaned (only known fields, bounded sizes, IPs must look like IPs), 256 KB / 50 scans per request.
- Stored per scan: player name and id, game, time, and for each server its address, location, ping, jitter, loss, verdict.
  Nothing about the players' own machines.
- Free tier is plenty for a handful of friends (Workers 100k requests/day, D1 5 GB).

## Deploy (the app's author does this once)
```powershell
cd server
npm install
npx wrangler login                                   # opens the browser, click "Allow"
npx wrangler d1 create gamenetkit                    # prints a database_id -> put it in wrangler.toml
npx wrangler d1 execute gamenetkit --remote --file=schema.sql
echo YOUR-GROUP-CODE | npx wrangler secret put GROUP_CODE
npx wrangler deploy                                  # prints https://gamenetkit.<your-subdomain>.workers.dev
```
Put that address in `Program.SyncServer` (src/Program.cs), rebuild and publish. Players type the group code once in the app.

## Test locally (no Cloudflare account)
```powershell
echo GROUP_CODE=TEST-CODE-1234 > .dev.vars
npx wrangler d1 execute gamenetkit --local --persist-to C:\gnk_d1 --file=schema.sql
npx wrangler dev --local --port 8787 --persist-to C:\gnk_d1
```
(`--persist-to` with a short path avoids Windows' path-length limit.) Then start the app with `--syncserver http://127.0.0.1:8787`.

## Remove someone / everything
`DELETE /v1/me` removes a player's scans (the app has no button for it yet); or delete rows in the Cloudflare dashboard (D1).
Changing the group code (`wrangler secret put GROUP_CODE`) locks everybody out until they type the new one.
