// The weekly challenge (#/weekly): ten puzzles (one attempt each), three games from set positions,
// and the leaderboard. Taking part needs an account; anyone can see the leaderboard.
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion, confirmDialog } from '../ui/modal.js';
import { createGame } from '../core/rules.js';
import { PERSONAS } from '../data/personas.js';
import { loadChallenge, loadLeaderboard, answerPuzzle, startGame, reportPlayer } from '../store/weekly.js';
import { navigate } from '../router.js';
import { currentUser, refreshMe } from '../store/account.js';
import { playSound } from '../ui/sound.js';
import { toast } from '../ui/toast.js';

const daysLeft = (endsAt) => Math.max(0, Math.ceil((endsAt - Date.now()) / 86_400_000));

// Signed-in players can report an offensive username (enough reports hide it).
function reportButton(username) {
  const button = h('button', {
    class: 'btn btn-small btn-report', type: 'button', testid: `report-${username}`, 'aria-label': `Report the username ${username}`,
    onClick: async () => {
      if (!(await confirmDialog({ title: 'Report this username?', message: `Report "${username}" as offensive? Usernames reported by several players are hidden from the leaderboard until we review them.`, confirmLabel: 'Report' }))) return;
      button.disabled = true;
      const r = await reportPlayer(username);
      if (!r.ok) { button.disabled = false; return toast(r.json.error ?? 'The report could not be sent.', { kind: 'warn' }); }
      button.textContent = 'Reported';
      button.setAttribute('aria-label', `Reported the username ${username}`);
      toast('Thanks — the username was reported.');
    },
  }, 'Report');
  return button;
}

function leaderboardTable(board) {
  const canReport = Boolean(board.me);
  return h('section', { class: 'menu-section', testid: 'leaderboard' },
    h('h2', {}, 'Leaderboard'),
    board.top.length
      ? h('table', { class: 'records' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Player'), h('th', { scope: 'col' }, 'Points'), canReport ? h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Report')) : null)),
        h('tbody', {}, board.top.map((r) => h('tr', { class: board.me?.username === r.username ? 'me' : '', testid: `rank-${r.username}` },
          h('td', {}, String(r.rank)), h('th', { scope: 'row' }, r.username), h('td', {}, String(r.score)),
          canReport ? h('td', {}, board.me.username === r.username ? null : reportButton(r.username)) : null))))
      : h('p', { class: 'muted' }, 'No scores yet this week — be the first.'),
    board.me ? h('p', { testid: 'my-rank' }, board.me.rank ? `You are #${board.me.rank} with ${board.me.score} points.` : 'You have no points yet this week.') : null,
    board.lastWeek.length ? h('p', { class: 'muted small', testid: 'last-week' }, `Last week: ${board.lastWeek.map((r) => `${['🥇', '🥈', '🥉'][r.rank - 1] ?? `#${r.rank}`} ${r.username} (${r.score})`).join(' · ')}`) : null,
    h('p', { class: 'muted small' }, 'Puzzles are worth 10 points each and are checked by the server. Games are worth 5 for a win and 2 for a draw; their results are self-reported. Ties go to whoever finished first.'));
}

export function renderWeekly(outlet) {
  const page = h('div', { class: 'page menu weekly', testid: 'weekly' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Weekly challenge'),
    h('h1', {}, 'Weekly challenge'),
    h('p', { class: 'muted', testid: 'weekly-loading' }, 'Loading…'));
  outlet.append(page);
  let board = null;
  let destroyed = false;
  let currentWeek = null;

  (async () => {
    const user = currentUser() ?? await refreshMe().catch(() => null);
    const [lb, ch] = await Promise.all([loadLeaderboard(), user ? loadChallenge() : Promise.resolve(null)]);
    if (destroyed) return;
    if (!lb.ok) {
      fill(page, page.firstChild, page.children[1], h('p', { testid: 'weekly-unavailable' }, lb.json.error ?? 'The weekly challenge is not available right now.'));
      return;
    }
    const parts = [];
    if (!user) {
      parts.push(h('p', { class: 'lede', testid: 'weekly-signin' }, 'Ten puzzles and three games, the same for everyone, every week. ', h('a', { href: '#/profile' }, 'Sign in or create an account'), ' to take part.'));
    } else if (ch?.ok) {
      const c = ch.json;
      currentWeek = c.week;
      const solved = c.puzzles.filter((p) => p.answered?.correct).length;
      parts.push(h('p', { class: 'lede', testid: 'weekly-summary' }, `Week of ${c.week} · ends in ${daysLeft(c.endsAt)} day${daysLeft(c.endsAt) === 1 ? '' : 's'} · ${solved}/10 puzzles solved`));
      const solver = h('div', { class: 'weekly-solver', testid: 'weekly-solver', hidden: true });
      parts.push(h('section', { class: 'menu-section' },
        h('h2', {}, 'Puzzles — one attempt each'),
        h('div', { class: 'puzzle-tiles' }, c.puzzles.map((p) => h('button', {
          class: `puzzle-tile${p.answered ? (p.answered.correct ? ' right' : ' wrong') : ''}`, type: 'button', testid: `wpuzzle-${p.index}`,
          'aria-label': `Puzzle ${p.index + 1}, rated ${p.rating}${p.answered ? (p.answered.correct ? ', solved' : ', missed') : ''}`,
          onClick: () => openPuzzle(solver, p),
        }, h('strong', {}, String(p.index + 1)), h('span', { class: 'small' }, String(p.rating)), p.answered ? h('span', { 'aria-hidden': 'true' }, p.answered.correct ? '✓' : '✗') : null))),
        solver));
      parts.push(h('section', { class: 'menu-section' },
        h('h2', {}, 'Games — play a position out'),
        h('p', { class: 'muted small' }, 'Your first finished game in each slot counts — a loss too. Resigning does not use up the slot.'),
        h('div', { class: 'option-list' }, c.games.map((g) => {
          const persona = PERSONAS.find((p) => p.id === g.persona);
          const color = createGame({ fen: g.fen }).turn();
          return h('div', { class: 'option-card', testid: `wgame-${g.slot}` },
            h('span', { class: 'option-icon', 'aria-hidden': 'true' }, persona.avatar),
            h('span', { class: 'option-text' }, h('strong', {}, g.title), h('span', { class: 'muted' }, `Against ${persona.name}${g.result ? ` · played: ${g.result.outcome}, ${g.result.points} points` : ''}`)),
            g.result ? h('span', { class: 'badge' }, 'Done')
              : h('button', {
                class: 'btn btn-small btn-primary', type: 'button', testid: `wplay-${g.slot}`,
                onClick: async () => {
                  const r = await startGame(c.week, g.slot);
                  if (!r.ok) return toast(r.json.error ?? 'Could not start the game.', { kind: 'warn' });
                  return navigate(`/play/bot?persona=${g.persona}&color=${color}&fen=${encodeURIComponent(g.fen)}&weekly=${g.slot}&week=${c.week}`);
                },
              }, 'Play ▸'));
        }))));
    } else {
      parts.push(h('p', {}, ch?.json?.error ?? 'Could not load this week\'s challenge.'));
    }
    parts.push(leaderboardTable(lb.json));
    fill(page, page.firstChild, page.children[1], parts);
  })();

  // One puzzle on a board: show the opponent's last move, take one move, report the verdict.
  function openPuzzle(host, p) {
    board?.destroy();
    host.hidden = false;
    const boardHost = h('div', { class: 'board-host weekly-board' });
    const live = liveRegion();
    const feedback = h('p', { class: 'lesson-feedback lesson-prompt', testid: 'wpuzzle-feedback' });
    const game = createGame({ fen: p.fen });
    const side = game.turn() === 'w' ? 'White' : 'Black';
    fill(host, h('h3', {}, `Puzzle ${p.index + 1} · rated ${p.rating}`), live.el, boardHost, feedback);
    let locked = Boolean(p.answered);
    const say = (text, kind) => { feedback.textContent = text; feedback.className = `lesson-feedback lesson-${kind}`; live.say(text); };
    board = new BoardView(boardHost, {
      fen: p.fen,
      orientation: game.turn(),
      legalMoves: (sq) => (locked ? [] : createGame({ fen: p.fen }).legalMoves(sq)),
      onMove: async (move) => {
        if (locked) return;
        const g = createGame({ fen: p.fen });
        const r = g.move(move);
        if (!r.ok) return;
        locked = true;
        board.setPosition(g.fen(), true);
        board.setInput(null);
        say('Checking…', 'prompt');
        const res = await answerPuzzle(currentWeek, p.index, r.uci);
        if (destroyed) return;
        if (res.status === 409) { say(res.json.error, 'wrong'); return; }
        if (!res.ok) { say(res.json.error ?? 'Could not save your answer.', 'wrong'); return; }
        p.answered = { move: r.uci, correct: res.json.correct, best: res.json.best };
        playSound(res.json.correct ? 'end' : 'notify');
        showVerdict();
        const tile = document.querySelector(`[data-testid="wpuzzle-${p.index}"]`);
        tile?.classList.add(res.json.correct ? 'right' : 'wrong');
      },
      choosePromotion,
    });
    board.highlight({ lastMove: p.lastMove });
    function showVerdict() {
      const best = p.answered.best;
      const san = createGame({ fen: p.fen }).move(best).san ?? best;
      if (p.answered.correct) say(`Right — ${san}! +10 points.`, 'success');
      else {
        say(`Not this time. The best move was ${san}.`, 'wrong');
        board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), type: 'success' }]);
      }
    }
    if (p.answered) { board.setInput(null); showVerdict(); } else { board.setInput(game.turn()); say(`${side} to move. Find the best move — you get one try.`, 'prompt'); }
    host.scrollIntoView?.({ block: 'nearest' });
  }

  return () => { destroyed = true; board?.destroy(); };
}
