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
    userById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
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
