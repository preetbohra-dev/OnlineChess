# Deployment: chess.solankidigitaldrafts.com

OnlineChess runs on this Mac behind the existing Cloudflare tunnel (`jodhpur-studio`). The tunnel also serves Tambola and the other demo sites.

| Piece | Where |
|---|---|
| Live checkout | `~/.jodhpur-studio/apps/onlinechess`. A **detached git worktree** of `feat/mvp`, so only committed code is live and the working copy is never served. |
| Process | launchd agent `in.jodhpurstudio.chess` (`~/Library/LaunchAgents/in.jodhpurstudio.chess.plist`). Runs `node server/index.js` with `PORT=3200` and `HOST=127.0.0.1`. KeepAlive is on. |
| Logs | `~/Library/Logs/chess/chess.log` |
| Accounts database | `~/.jodhpur-studio/data/chess.db` (SQLite, mode 600). Daily snapshots in `~/.jodhpur-studio/data/backups/` (seven kept). Not in the repository. |
| Tunnel rule | `~/.cloudflared/config.yml`: `chess.solankidigitaldrafts.com → http://localhost:3200` |
| DNS | CNAME `chess.solankidigitaldrafts.com` → tunnel (created with `cloudflared tunnel route dns`) |

## Ship a new version

```sh
git push                                                    # from the repo, after Gate 2
git -C ~/.jodhpur-studio/apps/onlinechess fetch origin
git -C ~/.jodhpur-studio/apps/onlinechess checkout --detach origin/feat/mvp
launchctl kickstart -k gui/$(id -u)/in.jodhpurstudio.chess
curl -s https://chess.solankidigitaldrafts.com/ | grep -o '<title>.*</title>'
```

From Slice 5 onward the server needs the `ws` package. Run `npm ci --omit=dev --ignore-scripts` in the live checkout before restarting. The vendored browser files are committed, so no build step is needed.

## Accounts

- Accounts and synced progress live in the SQLite file above. The server creates it, and its tables, on first start (`node:sqlite`, built into Node 22.5+; this Mac runs Node 26).
- To restore a backup: stop the agent, copy a `backups/chess-YYYY-MM-DD.db` over `chess.db` (and remove `chess.db-wal`/`-shm`), then start the agent.
- To reset a password or delete an account: `DB_PATH=~/.jodhpur-studio/data/chess.db node scripts/admin.mjs reset-password <user>` (or `delete-user <user>`), from the live checkout.

## Weekly challenge

- The challenge's puzzles come from `server/data/weekly-puzzles.json`, a separate sample of the Lichess database that the server never sends to browsers (the static root is `public/`).
- It is committed because this repository is private. If the repository is ever made public, move that file out of git (and rebuild it with `node scripts/puzzles.mjs --slot 1 --per-band 50 --out server/data/weekly-puzzles.json`), or the answers become public.

## Daily reminders (Web Push)

- The server creates its Web Push (VAPID) keys on first start in `~/.jodhpur-studio/secrets/chess-vapid.json` (mode 600). Keep that file: new keys would invalidate every existing subscription.
- The live server sends from this Mac to the browsers' push services (Google, Mozilla, Apple, Microsoft), so it needs outbound https.
- `PUSH=off` in the launchd environment disables reminders.

## Ports

- **Tambola uses 3000.** OnlineChess defaults to **3200**.
- On macOS, a `127.0.0.1:3000` listener silently takes traffic away from a `*:3000` listener. This is how a stray chess dev server once hijacked `tambola.solankidigitaldrafts.com`.
- Never run chess dev servers on 3000. `npm start` now defaults to 3200. If the launchd agent already holds 3200, a second server fails with `EADDRINUSE` instead of shadowing it.
- Tests use 4173 (Playwright) and ad-hoc ports above 4300.
