// The live channel (WebSocket /live) for signed-in players: who of their friends is online or in a
// game, and notices (friend requests, challenges) the moment they happen. The website signs in
// with its session cookie on the upgrade request; the apps send { type: 'auth', token } first.
//   server -> { type: 'hello', you, showPresence, friends: [{ code, online, playing }] }
//             { type: 'presence', code, online, playing }
//             { type: 'notice', kind, from, ... }
//   client -> { type: 'auth', token } (apps, first) · { type: 'status', playing }
const AUTH_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS_PER_USER = 6;
const MAX_MESSAGE_BYTES = 512;

export function createLive({ db, accounts, friends }) {
  const byUser = new Map(); // userId -> Set of connections { send, close, playing }
  let stopped = false;

  const visible = (userId) => Boolean(db.q.presenceSetting.get(userId)?.show_presence);
  function statusOf(userId) {
    const conns = byUser.get(userId);
    if (!conns?.size || !visible(userId)) return { online: false, playing: false };
    return { online: true, playing: [...conns].some((c) => c.playing) };
  }
  const codeOf = (userId) => db.q.friendCode.get(userId)?.friend_code ?? null;

  function sendTo(userId, message) {
    for (const c of byUser.get(userId) ?? []) c.send(message);
  }
  // Tell a player's friends how they are now. A hidden player sends nothing (not even "offline"
  // when they connect, which would give them away), except when they change the setting.
  function announce(userId, { force = false } = {}) {
    if (stopped || (!force && !visible(userId))) return;
    const code = codeOf(userId);
    if (!code) return;
    const message = { type: 'presence', code, ...statusOf(userId) };
    for (const friendId of friends.friendIds(userId)) sendTo(friendId, message);
  }

  function attach(userId, conn) {
    let conns = byUser.get(userId);
    if (!conns) byUser.set(userId, (conns = new Set()));
    if (conns.size >= MAX_CONNECTIONS_PER_USER) [...conns][0].close(4008, 'too many');
    const wasOnline = conns.size > 0;
    conns.add(conn);
    const user = db.q.userById.get(userId);
    conn.send({
      type: 'hello',
      you: { username: user.username, code: friends.codeFor(userId) },
      showPresence: visible(userId),
      friends: friends.friendIds(userId).map((id) => ({ code: codeOf(id), ...statusOf(id) })).filter((f) => f.code),
    });
    if (!wasOnline) announce(userId);
  }

  function detach(userId, conn) {
    if (stopped) return;
    const conns = byUser.get(userId);
    if (!conns?.delete(conn)) return;
    if (!conns.size) byUser.delete(userId);
    announce(userId);
  }

  return {
    // A new WebSocket on /live. `sessionUserId`: from the upgrade's cookie, if any.
    connection(ws, sessionUserId) {
      const conn = {
        playing: false,
        send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); },
        close: (code, reason) => ws.close(code, reason),
      };
      let userId = sessionUserId ?? null;
      const timer = userId ? null : setTimeout(() => ws.close(4401, 'sign in'), AUTH_TIMEOUT_MS);
      if (userId) attach(userId, conn);
      ws.on('message', (data, isBinary) => {
        if (isBinary || data.length > MAX_MESSAGE_BYTES) return ws.close(1009, 'too large');
        let m;
        try { m = JSON.parse(data.toString('utf8')); } catch { return ws.close(1007, 'bad message'); }
        if (!userId) {
          const user = m?.type === 'auth' && typeof m.token === 'string' ? accounts.userForToken(m.token) : null;
          if (!user) return ws.close(4401, 'sign in');
          clearTimeout(timer);
          userId = user.id;
          return attach(userId, conn);
        }
        if (m?.type === 'status' && typeof m.playing === 'boolean' && m.playing !== conn.playing) {
          const before = statusOf(userId).playing;
          conn.playing = m.playing;
          if (statusOf(userId).playing !== before) announce(userId);
        }
        return undefined;
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (userId) detach(userId, conn);
      });
      ws.on('error', () => {});
    },

    hasConnection: (userId) => Boolean(byUser.get(userId)?.size),
    notify: sendTo,
    // The player showed or hid their status: friends learn the new state at once.
    announce: (userId) => announce(userId, { force: true }),

    // A friend action through the API: tell the other player, and refresh presence for new friends.
    onFriendEvent(route, user, otherId, result) {
      if (!otherId) return;
      const from = { username: user.username, code: codeOf(user.id) };
      if (route === 'POST /api/friends/request' && result.status === 'sent') sendTo(otherId, { type: 'notice', kind: 'friend-request', from });
      if ((route === 'POST /api/friends/request' && result.status === 'friends') || route === 'POST /api/friends/accept') {
        sendTo(otherId, { type: 'notice', kind: 'friend-accepted', from });
        // Both now see each other's status.
        sendTo(otherId, { type: 'presence', code: codeOf(user.id), ...statusOf(user.id) });
        sendTo(user.id, { type: 'presence', code: codeOf(otherId), ...statusOf(otherId) });
      }
    },

    close() {
      stopped = true;
      for (const conns of byUser.values()) for (const c of conns) c.close(1001, 'server stopping');
      byUser.clear();
    },
  };
}
