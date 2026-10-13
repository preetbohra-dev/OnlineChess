// Challenges between friends, on screen: the "Challenge" dialog, the dialog for an incoming
// challenge (wherever the player is), and jumping into the game once it is accepted.
import { h } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { bus } from '../core/events.js';
import { TIME_CONTROLS } from '../core/clock.js';
import { sendChallenge, answerChallenge, loadChallenges } from '../store/challenges.js';
import { rememberSeat, hasSeat } from '../screens/online.js';
import { navigate } from '../router.js';

const tcLabel = (id) => TIME_CONTROLS.find((t) => t.id === id)?.label ?? 'No clock';
const colorText = (color, mine) => (color === 'random' ? 'colours drawn at random' : `${mine ? 'you play' : 'they play'} ${color === 'w' ? 'White' : 'Black'}`);

// "Challenge" a friend: time control and colour, then send.
export function openChallengeDialog(friend) {
  const tc = h('select', { class: 'text-input', testid: 'challenge-tc', 'aria-label': 'Time control' },
    TIME_CONTROLS.map((t) => h('option', { value: t.id, ...(t.id === '10+0' ? { selected: true } : {}) }, `${t.label} · ${t.kind}`)));
  const color = h('select', { class: 'text-input', testid: 'challenge-color', 'aria-label': 'Your colour' },
    h('option', { value: 'random' }, 'Random colour'), h('option', { value: 'w' }, 'I play White'), h('option', { value: 'b' }, 'I play Black'));
  const error = h('p', { class: 'form-error', role: 'alert', testid: 'challenge-error', hidden: true });
  const modal = openModal({
    title: `Challenge ${friend.username}`,
    testid: 'challenge-dialog',
    body: [h('label', { class: 'field' }, h('span', {}, 'Time control'), tc), h('label', { class: 'field' }, h('span', {}, 'Colour'), color), error],
    actions: [
      { label: 'Cancel', testid: 'btn-cancel' },
      {
        label: 'Send challenge', testid: 'btn-send-challenge', primary: true, keepOpen: true,
        onClick: async () => {
          const r = await sendChallenge(friend.code, tc.value, color.value);
          if (!r.ok) { error.textContent = r.error; error.hidden = false; return; }
          modal.close('action');
          toast(`Challenge sent to ${friend.username}. It is open for 15 minutes.`);
          bus.emit('challenges:change', {});
        },
      },
    ],
  });
}

const shown = new Map(); // challenge id -> open dialog (never two for the same challenge)
const onGameScreen = () => /^#\/(play\/(local|bot|online)|room|train\/coach\/play)/.test(location.hash);

// Someone challenged you.
export function showIncoming(challenge) {
  const { with: from, tc, color, id } = challenge;
  if (shown.has(id)) return;
  const mine = color === 'random' ? 'random' : color === 'w' ? 'b' : 'w';
  const dialog = openModal({
    title: `${from.username} challenges you`,
    testid: 'incoming-challenge',
    keepOnRoute: true, // stays while the player moves around, until answered
    onClose: () => shown.delete(id),
    body: [h('p', {}, `${tcLabel(tc)} · ${colorText(mine, true)}.`)],
    actions: [
      { label: 'Not now', testid: 'btn-decline-challenge', onClick: () => answerChallenge(id, false).then(() => bus.emit('challenges:change', {})) },
      {
        label: 'Accept', testid: 'btn-accept-challenge', primary: true,
        onClick: async () => {
          const r = await answerChallenge(id, true);
          if (!r.ok) return toast(r.error, { kind: 'warn' });
          return openGame(r.json.challenge);
        },
      },
    ],
  });
  shown.set(id, dialog);
}

// A challenge that is no longer open: close its dialog if it is showing.
function closeIncoming(id) {
  shown.get(id)?.close('gone');
  shown.delete(id);
}

// A game is ready: straight in, unless the player is in another game (then they are asked).
function gameReady(challenge) {
  if (!onGameScreen()) { toast(`Game on with ${challenge.with.username}!`); openGame(challenge); return; }
  openModal({
    title: `${challenge.with.username}'s game is ready`,
    testid: 'game-ready',
    body: [h('p', {}, 'Leave this game and start that one?')],
    actions: [{ label: 'Later', testid: 'btn-later' }, { label: 'Play now', testid: 'btn-play-now', primary: true, onClick: () => openGame(challenge) }],
  });
}

// Into the game: keep the seat for #/room/<id>, which takes it.
export function openGame(challenge) {
  const game = challenge?.game;
  if (!game) return;
  rememberSeat(game.room, game.token);
  navigate(`/room/${game.room}`);
}

// Start-up: notices from the live channel, and games accepted while this player was away.
export function startChallenges() {
  bus.on('live:notice', (n) => {
    if (n.kind === 'challenge') showIncoming(n.challenge);
    else if (n.kind === 'game-ready') {
      if (!hasSeat(n.challenge.game.room)) gameReady(n.challenge);
    } else if (n.kind === 'challenge-declined') toast(`${n.with.username} can't play right now.`);
    else if (n.kind === 'challenge-expired') toast(`Your challenge to ${n.with.username} expired.`);
    else if (n.kind === 'challenge-cancelled') { closeIncoming(n.id); toast('A challenge was withdrawn.'); }
    if (n.kind.startsWith('challenge') || n.kind === 'game-ready') bus.emit('challenges:change', {});
  });
  bus.on('live:hello', async () => {
    const r = await loadChallenges();
    if (!r.ok) return;
    for (const c of r.json.incoming) showIncoming(c);
    const waiting = r.json.ready.find((c) => !hasSeat(c.game.room));
    if (waiting) {
      openModal({
        title: `${waiting.with.username} accepted your challenge`,
        testid: 'game-ready',
        body: [h('p', {}, 'Your game is ready.')],
        actions: [{ label: 'Later', testid: 'btn-later' }, { label: 'Play now', testid: 'btn-play-now', primary: true, onClick: () => openGame(waiting) }],
      });
    }
  });
}
