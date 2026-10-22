// The live channel, client side: while signed in, one WebSocket to /live keeps friends' online
// status and brings notices (friend requests, challenges) at once. Reconnects with back-off.
//   bus events: 'live:hello' { you, showPresence }, 'live:presence' { code, online, playing },
//               'live:notice' { kind, from, … }
import { bus } from '../core/events.js';
import { currentUser, refreshMe } from '../store/account.js';

const presence = new Map(); // friend code -> { online, playing }
let ws = null;
let attempts = 0;
let timer = null;
let me = null; // { you, showPresence } from the last hello

export const friendStatus = (code) => presence.get(code) ?? { online: false, playing: false };
export const liveInfo = () => me;

function url() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`;
}

// Playing = on a game screen (any board you play on).
const playingNow = () => /^#\/(play\/(local|bot|online)|room|train\/coach\/play|weekly)/.test(location.hash);
function sendStatus() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'status', playing: playingNow() }));
}

function connect() {
  clearTimeout(timer);
  if (!currentUser() || ws) return;
  const socket = new WebSocket(url());
  ws = socket;
  socket.onopen = () => { attempts = 0; };
  socket.onmessage = (event) => {
    let m;
    try { m = JSON.parse(event.data); } catch { return; }
    if (m.type === 'hello') {
      me = { you: m.you, showPresence: m.showPresence };
      presence.clear();
      for (const f of m.friends ?? []) presence.set(f.code, { online: f.online, playing: f.playing });
      sendStatus();
      bus.emit('live:hello', me);
    } else if (m.type === 'presence') {
      if (m.removed) presence.delete(m.code); else presence.set(m.code, { online: m.online, playing: m.playing });
      bus.emit('live:presence', m);
    } else if (m.type === 'notice') {
      bus.emit('live:notice', m);
    }
  };
  socket.onclose = (event) => {
    if (ws === socket) ws = null;
    if (!currentUser()) return;
    if (event.code === 4008) return; // open in too many tabs: this one waits until it is shown again
    attempts++;
    const later = () => { timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5))); };
    // Turned away as signed out: ask the server who we are before trying again.
    if (event.code === 4401) refreshMe().then((user) => { if (user) later(); });
    else later();
  };
}

function disconnect() {
  clearTimeout(timer);
  const socket = ws;
  ws = null;
  me = null;
  presence.clear();
  socket?.close(1000, 'signed out');
}

// Start-up: follow sign-in and sign-out, and tell friends when a game screen is open.
export function startLive() {
  bus.on('account:change', ({ user }) => (user ? connect() : disconnect()));
  window.addEventListener('hashchange', sendStatus);
  // Phones pause pages in the background: reconnect straight away when the page is back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !ws) { attempts = 0; connect(); } });
  if (currentUser()) connect();
}
