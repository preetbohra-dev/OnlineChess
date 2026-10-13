#!/usr/bin/env node
// Account administration for the accounts database (DB_PATH, default ~/.jodhpur-studio/data/chess.db).
//   node scripts/admin.mjs reset-password <username>   (reads the new password from stdin)
//   node scripts/admin.mjs delete-user <username>
//   node scripts/admin.mjs fix-week <pool.json>     (stores this week's challenge set from that pool, if
//                                                   not stored yet: run before switching pools)
//   node scripts/admin.mjs reports                  (reported usernames, newest first)
//   node scripts/admin.mjs hide <username> | unhide <username>   (leaderboard visibility)
import { createInterface } from 'node:readline';
import { openDatabase } from '../server/db.js';
import { createAccounts } from '../server/auth.js';
import { challengeWeek, weeklySet, loadPuzzleLibrary } from '../server/challenge.js';

// Read a line from the terminal without echoing it (falls back to a plain line when piped).
function readSecret() {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    return new Promise((resolve) => rl.once('line', (line) => { rl.close(); resolve(line); }));
  }
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        resolve(value);
      } else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f') value = value.slice(0, -1);
      else value += ch;
    };
    process.stdin.on('data', onData);
  });
}

const [command, username] = process.argv.slice(2);
if (!['reset-password', 'delete-user', 'fix-week', 'reports', 'hide', 'unhide'].includes(command) || (!username && command !== 'reports')) {
  console.error('Usage: node scripts/admin.mjs reset-password <username> | delete-user <username> | fix-week <pool.json> | reports | hide <username> | unhide <username>');
  process.exit(2);
}
const db = openDatabase();
const accounts = createAccounts(db);
try {
  if (command === 'fix-week') {
    const poolFile = username;
    const week = challengeWeek();
    const added = db.q.addWeekSet.run(week, JSON.stringify(weeklySet(week, loadPuzzleLibrary(poolFile))), Date.now()).changes === 1;
    console.log(added ? `Stored the challenge set for the week of ${week}.` : `The week of ${week} already has a stored set.`);
  } else if (command === 'reports') {
    const rows = db.q.reportList.all();
    if (!rows.length) console.log('No reports.');
    for (const r of rows) console.log(`${r.username}\t${r.reports} report(s)\t${r.hidden ? 'hidden' : 'visible'}\tlast ${new Date(r.last).toISOString()}`);
  } else if (command === 'hide' || command === 'unhide') {
    const user = db.q.userByName.get(username);
    if (!user) console.log(`No user ${username}.`);
    else {
      db.q.setHidden.run(command === 'hide' ? 1 : 0, user.id);
      if (command === 'unhide') db.q.clearReports.run(user.id); // a fresh start: old reports do not hide them again
      console.log(`${user.username} is now ${command === 'hide' ? 'hidden from' : 'shown on'} the leaderboard (live within 15 seconds).`);
    }
  } else if (command === 'delete-user') {
    console.log(accounts.deleteUser(username) ? `Deleted ${username} and their progress.` : `No user ${username}.`);
  } else {
    process.stdout.write(`New password for ${username}: `);
    const password = await readSecret();
    process.stdout.write('\n');
    console.log(await accounts.resetPassword(username, password) ? `Password reset; ${username} is signed out everywhere.` : `No user ${username}.`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
