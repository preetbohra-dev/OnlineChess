// Online play: create a room, share the link, join or resume a room.
import { h } from '../ui/dom.js';
import { navigate } from '../router.js';
import { timeControlPicker } from './local-setup.js';
import { appStore } from '../store/storage.js';
import { mountGameScreen } from '../ui/game-screen.js';
import { createOnlineClient } from '../net/online-client.js';
import { createOnlineSession } from '../sessions/online-session.js';
import { TIME_CONTROLS } from '../core/clock.js';
import { currentUser } from '../store/account.js';

const NAME = /^[\p{L}\p{N} _'-]{1,20}$/u;
const tokenKey = (room) => `oc.room.${room}`;
const ERRORS = {
  room_not_found: 'That room does not exist any more. Rooms close after a while without players.',
  room_full: 'That room already has two players.',
  server_full: 'The server is busy right now. Please try again in a minute.',
  too_many_rooms: 'You have opened a lot of rooms recently. Finish or leave one, or try again later.',
  bad_token: 'Your seat in this room has expired.',
};

function readToken(room) {
  try { return sessionStorage.getItem(tokenKey(room)); } catch { return null; }
}
function saveToken(room, token) {
  try { sessionStorage.setItem(tokenKey(room), token); } catch { /* private mode: no resume */ }
}
// A seat handed out by the server (an accepted friend challenge): #/room/<id> takes it.
export const rememberSeat = saveToken;
export const hasSeat = (room) => Boolean(readToken(room));

function nameField(store) {
  const input = h('input', {
    class: 'text-input', testid: 'online-name', type: 'text', maxlength: 20, autocomplete: 'nickname',
    placeholder: 'Your name', 'aria-label': 'Your name', required: true,
  });
  input.value = store.get('onlineName', '') || currentUser()?.username || '';
  return input;
}

function validName(input) {
  const name = input.value.trim();
  if (NAME.test(name)) return name;
  input.setCustomValidity('Use 1–20 letters, numbers, spaces, _ - or \'.');
  input.reportValidity();
  input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
  return null;
}

export function renderOnlineNew(outlet) {
  const store = appStore();
  const name = nameField(store);
  let tc = '5+0';
  let color = 'random';
  const colorPicker = h('span', { class: 'segments', role: 'radiogroup', 'aria-label': 'Your colour' },
    [['w', '♔ White'], ['random', '🎲 Random'], ['b', '♚ Black']].map(([value, text]) => {
      const input = h('input', { type: 'radio', name: 'color', value, testid: `color-${value}`, onChange: () => { color = value; } });
      input.checked = value === color;
      return h('label', { class: 'segment' }, input, h('span', {}, text));
    }));
  outlet.append(h('div', { class: 'page menu setup' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/play' }, 'Normal Mode'), ' / Online'),
    h('h1', {}, 'Play a friend online'),
    h('p', { class: 'muted' }, 'Create a room, send your friend the link, and play from anywhere.'),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Your name'), name),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Your colour'), colorPicker),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Time control'), timeControlPicker(tc, (id) => { tc = id; })),
    h('div', { class: 'setup-actions' },
      h('button', {
        class: 'btn btn-primary btn-large', type: 'button', testid: 'btn-create-room',
        onClick: () => {
          const valid = validName(name);
          if (!valid) return;
          store.set('onlineName', valid);
          navigate(`/room/new?${new URLSearchParams({ name: valid, tc, color })}`);
        },
      }, 'Create room'))));
}

// #/room/new?name&tc&color creates a room; #/room/ABC123 resumes (token) or asks for a name.
export function renderRoom(outlet, { params, query }) {
  const store = appStore();
  const roomParam = params.id;
  const client = createOnlineClient();
  let roomId = roomParam === 'new' ? null : roomParam;
  let screen = null;
  let session = null;

  const status = h('div', { class: 'page menu room-status', testid: 'room-status' }, h('p', {}, 'Connecting…'));
  outlet.append(status);

  function showMessage(text, { join = false } = {}) {
    status.replaceChildren(
      h('h1', {}, join ? 'Join game' : 'Online game'),
      h('p', {}, text),
      join ? joinForm() : h('p', {}, h('a', { href: '#/play/online/new', class: 'btn btn-primary' }, 'Create a new room')));
  }

  function joinForm() {
    const name = nameField(store);
    return h('form', {
      class: 'join-form',
      onSubmit: (e) => {
        e.preventDefault();
        const valid = validName(name);
        if (!valid) return;
        store.set('onlineName', valid);
        client.send({ type: 'join', room: roomId, name: valid });
      },
    }, name, h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-join' }, 'Join'));
  }

  function hello() {
    if (roomParam === 'new' && !roomId) {
      const tc = TIME_CONTROLS.some((t) => t.id === query.get('tc')) ? query.get('tc') : 'none';
      client.send({ type: 'create', name: query.get('name') ?? '', tc, color: query.get('color') ?? 'random' });
      return;
    }
    const token = readToken(roomId);
    if (token) client.send({ type: 'resume', room: roomId, token });
    else client.send({ type: 'peek', room: roomId });
  }

  client.on('room', (m) => {
    if (screen) return;
    if (!m.exists) showMessage(ERRORS.room_not_found);
    else if (m.full) showMessage(ERRORS.room_full);
    else showMessage('Enter your name to join this game.', { join: true });
  });
  client.on('replaced', () => {
    screen?.destroy();
    screen = null;
    outlet.replaceChildren(status);
    showMessage('This game is now open in another tab or window.');
  });

  client.on('open', hello);
  client.on('joined', (m) => {
    roomId = m.room;
    saveToken(m.room, m.token);
    if (roomParam === 'new') history.replaceState(null, '', `#/room/${m.room}`);
    if (!session) {
      session = createOnlineSession({ client, roomId: m.room });
      const off = client.on('state', () => {
        off();
        status.remove();
        screen = mountGameScreen(outlet, session, { orientation: session.you(), onNewGame: () => navigate('/play/online/new') });
      });
    }
  });
  client.on('error', (m) => {
    if (m.code === 'bad_token') {
      try { sessionStorage.removeItem(tokenKey(roomId)); } catch { /* ignore */ }
      showMessage(ERRORS.bad_token + ' Enter your name to join again.', { join: true });
    } else if (ERRORS[m.code] && !screen) {
      showMessage(ERRORS[m.code]);
    }
  });

  return () => {
    screen?.destroy();
    session?.destroy();
    client.close();
  };
}
