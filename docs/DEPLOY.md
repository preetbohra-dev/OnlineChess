# Deployment: onlinechess.preetbohra.com

OnlineChess runs on a Windows PC behind the shared Cloudflare tunnel `applyai`. The tunnel also serves preetbohra.com, memories.preetbohra.com, ChhatPhatt and the Tally sites. (Until October 2026 it ran on a Mac as chess.solankidigitaldrafts.com.)

| Piece | Where |
|---|---|
| Live checkout | `%USERPROFILE%\.jodhpur-studio\apps\onlinechess`. A **detached git worktree** of `main`, so only merged code is live and the working copy is never served. |
| Process | Scheduled task `OnlineChess` (`scripts/windows/register-task.ps1`), at logon and every 5 minutes. It runs `scripts/windows/supervise-chess.ps1`, which starts `node server/index.js` with `PORT=3200`, `HOST=127.0.0.1`, `ALLOWED_HOSTS=onlinechess.preetbohra.com` and `PUBLIC_ORIGIN=https://onlinechess.preetbohra.com` when nothing listens on 3200. |
| Logs | `%USERPROFILE%\.jodhpur-studio\logs\chess\` (`chess.log`, `chess.err.log`, `status.txt`, `supervisor.log`) |
| Accounts database | `%USERPROFILE%\.jodhpur-studio\data\chess.db`. Daily snapshots in `backups\` beside it (seven kept). Not in the repository. |
| Tunnel rule | `%USERPROFILE%\.cloudflared\config.yml`: `onlinechess.preetbohra.com → http://localhost:3200`. Two connectors run the tunnel (started by the TallyDocumentTranslator and MemoryTimeline supervisors); restart both after changing the file. |
| DNS | CNAME `onlinechess.preetbohra.com` → tunnel (created with `cloudflared tunnel route dns applyai onlinechess.preetbohra.com`) |

## Ship a new version

```powershell
# after the change is merged to main on GitHub
$live = "$env:USERPROFILE\.jodhpur-studio\apps\onlinechess"
git -C $live fetch origin
git -C $live checkout --detach origin/main
Push-Location $live; npm ci --omit=dev --ignore-scripts; Pop-Location
# stop the server; the supervisor starts the new version (or run it now)
Get-NetTCPConnection -LocalPort 3200 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Start-ScheduledTask OnlineChess
```

The vendored browser files are committed, so no build step is needed.

There are no store apps. Players install the site itself from the browser (Android: the Install button; iPhone: Share, then Add to Home Screen), and it plays online whenever this server is up.

## Accounts

- Accounts and synced progress live in the SQLite file above. The server creates it, and its tables, on first start (`node:sqlite`, built into Node 22.5+).
- To restore a backup: stop the server (the supervisor restarts it within 5 minutes, so disable the `OnlineChess` task first), copy a `backups/chess-YYYY-MM-DD.db` over `chess.db` (and remove `chess.db-wal`/`-shm`), then enable the task again.
- To reset a password or delete an account: `DB_PATH=~/.jodhpur-studio/data/chess.db node scripts/admin.mjs reset-password <user>` (or `delete-user <user>`), from the live checkout.

## Weekly challenge

- The challenge's puzzles come from `~/.jodhpur-studio/data/weekly-puzzles.json` (or `WEEKLY_POOL_FILE`), a separate sample of the Lichess database kept outside the repository, because the source code is public. The server never sends it to browsers.
- Build it with `node scripts/puzzles.mjs --slot 2 --per-band 50 --out ~/.jodhpur-studio/data/weekly-puzzles.json`. Slot 0 is the public library and slot 1 the retired pool that is now the test fixture (`tests/fixtures/weekly-puzzles.json`), so never use those for the live pool.
- Each week's set is stored in the database the first time the week is served, so replacing the pool only affects weeks that have not started. Before switching pools mid-week, store the current week from the old pool: `DB_PATH=~/.jodhpur-studio/data/chess.db node scripts/admin.mjs fix-week <old-pool.json>`.
- The first deploy with an outside pool (October 2026) must fix the running week from the retired pool before the restart: `DB_PATH=~/.jodhpur-studio/data/chess.db node scripts/admin.mjs fix-week tests/fixtures/weekly-puzzles.json`.
- Without the pool file (or with a broken one) the challenge answers 503 and the rest of the site works.

## Daily reminders (Web Push)

- The server creates its Web Push (VAPID) keys on first start in `~/.jodhpur-studio/secrets/chess-vapid.json` (mode 600). Keep that file: new keys would invalidate every existing subscription.
- The live server sends from this PC to the browsers' push services (Google, Mozilla, Apple, Microsoft), so it needs outbound https.
- `PUSH=off` in the server's environment (`supervise-chess.ps1`) disables reminders.

## Ports

- OnlineChess uses **3200**. The other sites on this PC use 3000, 3002, 3004, 3010, 4000 and 8100.
- Never run chess dev servers on another site's port. If the live server already holds 3200, a second server fails with `EADDRINUSE` instead of shadowing it.
- Tests use 4173 (Playwright) and ad-hoc ports above 4300.

## Sign-in emails and Google (Plan 4)

- Keys live in `~/.jodhpur-studio/secrets/chess-auth.env` (mode 600, never in the repository): `RESEND_API_KEY` (a Resend key with sending access only), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The server reads them at start: restart after changing them. Without a key, that sign-in method is switched off and the page does not offer it.
- This PC has no keys yet (October 2026), so only existing username accounts can sign in; new players play as guests.
- Emails come from `no-reply@chess.solankidigitaldrafts.com` (`server/mail.js`). Its DKIM, SPF and bounce records are in that domain's Cloudflare DNS, as Resend shows them. To send from preetbohra.com instead, verify it in Resend and change `FROM`.
- The Google OAuth client (Google Cloud project "OnlineChess", type Web application) must list the redirect URI `https://onlinechess.preetbohra.com/auth/google/callback`.
- New username accounts are switched off (`POST /api/register` answers 410). Existing username accounts still sign in and are asked to add an email.
- `MAIL=dry`, `TEST_HOOKS` and `AUTH_ENV_FILE=/nonexistent…` are for test runs only. Never set them on the live server.
