// Accounts database: SQLite through Node's built-in node:sqlite (no extra dependency).
// The file lives outside the repository (DB_PATH, default ~/.jodhpur-studio/data/chess.db);
// tests use ':memory:'. Migrations run at open, tracked with PRAGMA user_version.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DB_PATH = path.join(os.homedir(), '.jodhpur-studio', 'data', 'chess.db');

const MIGRATIONS = [
  // 1: users, sessions, synced state
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE states (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // 2: Web Push subscriptions for daily-puzzle reminders
  `CREATE TABLE push_subscriptions (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     endpoint TEXT NOT NULL UNIQUE,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     tz TEXT NOT NULL,
     hour INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     last_sent_day TEXT,
     failures INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX push_user ON push_subscriptions(user_id);`,
  // 3: the weekly challenge
  `CREATE TABLE challenge_answers (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     week TEXT NOT NULL,
     idx INTEGER NOT NULL,
     move TEXT NOT NULL,
     correct INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (user_id, week, idx)
   );
   CREATE TABLE challenge_games (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     week TEXT NOT NULL,
     slot INTEGER NOT NULL,
     outcome TEXT NOT NULL,
     points INTEGER NOT NULL,
     plies INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (user_id, week, slot)
   );
   CREATE TABLE challenge_starts (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     week TEXT NOT NULL,
     slot INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (user_id, week, slot)
   );
   CREATE INDEX challenge_answers_week ON challenge_answers(week);
   CREATE INDEX challenge_games_week ON challenge_games(week);`,
  // 4: each week's challenge set, fixed when the week is first served (so changing the pool never
  // changes a week that has started)
  `CREATE TABLE challenge_sets (
     week TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
  // 5: reports of offensive usernames; a reported user can be hidden from the leaderboard
  `ALTER TABLE users ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE reports (
     reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (reporter_id, reported_id)
   );
   CREATE INDEX reports_reported ON reports(reported_id);`,
  // 6: email accounts. An email is confirmed before it is ever stored, so every stored email is
  // the player's. One-time sign-in links and codes (only their hashes) live in email_tokens;
  // `payload` holds a pending sign-up (display name, password hash) until it is confirmed.
  `ALTER TABLE users ADD COLUMN email TEXT;
   ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
   CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
   CREATE TABLE email_tokens (
     token_hash TEXT PRIMARY KEY,
     code_hash TEXT NOT NULL,
     email TEXT NOT NULL,
     purpose TEXT NOT NULL,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     payload TEXT,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER,
     tries INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX email_tokens_email ON email_tokens(email);`,
  // 7: sign-in with Google (and later Apple): one row per outside account linked to a player
  `CREATE TABLE identities (
     provider TEXT NOT NULL,
     subject TEXT NOT NULL,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     email TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (provider, subject)
   );
   CREATE INDEX identities_user ON identities(user_id);`,
];

export function openDatabase(file = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (file !== ':memory:') {
    process.umask(0o077); // the database, its WAL files and backups are readable by this user only
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* best effort */ }
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
  return wrap(db);
}

// Named statements over the raw database.
function wrap(db) {
  const q = {
    insertUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare("SELECT id, username, created_at, email, pass_hash <> '!' AS has_password FROM users WHERE id = ?"),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertEmailUser: db.prepare('INSERT INTO users (username, pass_hash, created_at, email, email_verified_at) VALUES (?, ?, ?, ?, ?)'),
    setEmail: db.prepare('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?'),
    setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    addEmailToken: db.prepare('INSERT INTO email_tokens (token_hash, code_hash, email, purpose, user_id, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    emailTokenByHash: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'),
    activeEmailTokens: db.prepare('SELECT * FROM email_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ? AND tries < ?'),
    useEmailToken: db.prepare('UPDATE email_tokens SET used_at = ?, payload = NULL WHERE token_hash = ? AND used_at IS NULL'),
    voidEmailTokens: db.prepare('UPDATE email_tokens SET used_at = ?, payload = NULL WHERE email = ? AND used_at IS NULL'),
    pruneEmailTokens: db.prepare('DELETE FROM email_tokens WHERE expires_at < ?'),
    setLoginState: db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    countUserSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'),
    oldestUserSession: db.prepare('DELETE FROM sessions WHERE token_hash = (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at LIMIT 1)'),
    state: db.prepare('SELECT data, updated_at FROM states WHERE user_id = ?'),
    upsertPush: db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tz, hour, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz, hour = excluded.hour, failures = 0
      WHERE push_subscriptions.user_id = excluded.user_id`), // another account cannot take over an endpoint
    countAllPush: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions'),
    countPush: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?'),
    oldestPush: db.prepare('DELETE FROM push_subscriptions WHERE id = (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at LIMIT 1)'),
    pushForUser: db.prepare('SELECT endpoint, tz, hour FROM push_subscriptions WHERE user_id = ?'),
    deletePush: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'),
    deletePushEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    // Only what the scheduler needs: the daily puzzle fields of the synced state, not all of it.
    allPush: db.prepare(`SELECT p.id, p.endpoint, p.p256dh, p.auth, p.tz, p.hour, p.last_sent_day, p.failures,
      json_extract(s.data, '$.profile.daily.last') AS daily_last, json_extract(s.data, '$.profile.daily.streak') AS daily_streak
      FROM push_subscriptions p LEFT JOIN states s ON s.user_id = p.user_id`),
    markPushSent: db.prepare('UPDATE push_subscriptions SET last_sent_day = ? WHERE id = ?'),
    pushFailed: db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?'),
    pushOk: db.prepare('UPDATE push_subscriptions SET failures = 0 WHERE id = ?'),
    answers: db.prepare('SELECT idx, move, correct FROM challenge_answers WHERE user_id = ? AND week = ?'),
    addAnswer: db.prepare('INSERT OR IGNORE INTO challenge_answers (user_id, week, idx, move, correct, at) VALUES (?, ?, ?, ?, ?, ?)'),
    startGame: db.prepare('INSERT OR IGNORE INTO challenge_starts (user_id, week, slot, at) VALUES (?, ?, ?, ?)'),
    gameStart: db.prepare('SELECT at FROM challenge_starts WHERE user_id = ? AND week = ? AND slot = ?'),
    gamesPlayed: db.prepare('SELECT slot, outcome, points FROM challenge_games WHERE user_id = ? AND week = ?'),
    addReport: db.prepare('INSERT OR IGNORE INTO reports (reporter_id, reported_id, created_at) VALUES (?, ?, ?)'),
    // Reports that count towards hiding: only from accounts at least a day old (so a burst of new
    // accounts cannot hide someone).
    countReports: db.prepare('SELECT COUNT(*) AS n FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.reported_id = ? AND u.created_at <= ?'),
    reportsBy: db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?'),
    setHidden: db.prepare('UPDATE users SET hidden = ? WHERE id = ?'),
    clearReports: db.prepare('DELETE FROM reports WHERE reported_id = ?'),
    reportList: db.prepare(`SELECT u.username, u.hidden, COUNT(r.reporter_id) AS reports, MAX(r.created_at) AS last
      FROM users u JOIN reports r ON r.reported_id = u.id GROUP BY u.id ORDER BY last DESC`),
    identity: db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?'),
    addIdentity: db.prepare('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'),
    identitiesForUser: db.prepare('SELECT provider, email FROM identities WHERE user_id = ?'),
    weekSet: db.prepare('SELECT data FROM challenge_sets WHERE week = ?'),
    addWeekSet: db.prepare('INSERT OR IGNORE INTO challenge_sets (week, data, created_at) VALUES (?, ?, ?)'),
    addGame: db.prepare('INSERT OR IGNORE INTO challenge_games (user_id, week, slot, outcome, points, plies, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    // Score per player for a week: puzzle points + game points; ties go to whoever finished first.
    leaderboard: db.prepare(`WITH scores AS (
        SELECT user_id, SUM(points) AS score, MAX(at) AS last FROM (
          SELECT user_id, correct * ? AS points, at FROM challenge_answers WHERE week = ?
          UNION ALL SELECT user_id, points, at FROM challenge_games WHERE week = ?)
        GROUP BY user_id)
      SELECT u.username, s.user_id, s.score, s.last, RANK() OVER (ORDER BY s.score DESC, s.last ASC) AS rank
      FROM scores s JOIN users u ON u.id = s.user_id WHERE s.score > 0 AND u.hidden = 0 ORDER BY rank LIMIT ?`),
    myRank: db.prepare(`WITH scores AS (
        SELECT user_id, SUM(points) AS score, MAX(at) AS last FROM (
          SELECT user_id, correct * ? AS points, at FROM challenge_answers WHERE week = ?
          UNION ALL SELECT user_id, points, at FROM challenge_games WHERE week = ?)
        GROUP BY user_id),
      ranked AS (SELECT s.user_id, s.score, RANK() OVER (ORDER BY s.score DESC, s.last ASC) AS rank
        FROM scores s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 OR s.user_id = ?)
      SELECT score, rank FROM ranked WHERE user_id = ?`),
    putState: db.prepare('INSERT INTO states (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
  };
  return {
    raw: db,
    q,
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
    // A consistent copy for backups (VACUUM INTO writes a compact snapshot).
    backup(to) {
      db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
      try { fs.chmodSync(to, 0o600); } catch { /* best effort */ }
    },
    close() { db.close(); },
  };
}
