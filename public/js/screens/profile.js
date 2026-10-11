// The profile page (rank, XP, records, achievements) and the dashboard shown on the home page.
import { h } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { loadProfile, resetProfile } from '../store/profile.js';
import { rankFor, ACHIEVEMENTS, currentStreak, dayKey } from '../core/progression.js';
import { PERSONAS } from '../data/personas.js';
import { ALL_LESSONS } from '../data/lessons/index.js';
import { completedLessons } from '../store/progress.js';
import { totalStars } from '../core/campaign.js';
import { questView } from '../core/quests.js';
import { dueToday } from '../store/weakspots.js';
import { canInstall, install } from '../ui/pwa.js';
import { currentUser, lastSynced, login, register, logout, syncNow } from '../store/account.js';
import { bus } from '../core/events.js';
import { fill } from '../ui/dom.js';
import { pushSupported, currentSubscription, enableReminders, disableReminders, savedHour, REMINDER_HOURS } from '../ui/reminders.js';

// Daily-puzzle reminders (signed-in players): on/off for this browser, and the hour.
function remindersSection() {
  const section = h('section', { class: 'menu-section reminders', testid: 'reminders', 'aria-labelledby': 'reminders-heading' });
  let on = false;
  let message = '';
  let busy = false;
  const hourSelect = h('select', { testid: 'reminder-hour', 'aria-label': 'Reminder time' },
    REMINDER_HOURS.map((hr) => { const o = h('option', { value: hr }, `${String(hr).padStart(2, '0')}:00`); o.selected = hr === savedHour(); return o; }));
  async function toggle(enable) {
    busy = true; message = ''; render();
    if (enable) {
      const r = await enableReminders(Number(hourSelect.value));
      on = r.ok;
      message = r.ok ? 'Reminders are on for this browser.' : r.error;
    } else {
      await disableReminders();
      on = false;
      message = 'Reminders are off.';
    }
    busy = false;
    render();
  }
  function render() {
    fill(section,
      h('h2', { id: 'reminders-heading' }, 'Daily reminder'),
      !pushSupported()
        ? h('p', { class: 'muted' }, 'This browser cannot show reminders. On iPhone, add the app to your home screen first.')
        : [h('p', { class: 'muted' }, 'One notification a day, at the hour you choose, only if today\'s puzzle is still unsolved.'),
          h('div', { class: 'lesson-actions' },
            h('label', { class: 'field inline' }, h('span', {}, 'Time'), hourSelect),
            h('button', { class: `btn${on ? '' : ' btn-primary'}`, type: 'button', testid: 'btn-reminders', disabled: busy, onClick: () => toggle(!on) }, on ? 'Turn off' : 'Turn on reminders')),
          message ? h('p', { class: 'small', role: 'status', testid: 'reminders-status' }, message) : null]);
  }
  render();
  currentSubscription().then((sub) => { on = Boolean(sub); render(); }).catch(() => {});
  return section;
}

// Sign in / create an account, or (signed in) who you are and when progress last synced.
function accountSection() {
  const section = h('section', { class: 'menu-section account', testid: 'account', 'aria-labelledby': 'account-heading' });
  let mode = 'login';
  let error = '';
  let busy = false;

  function form() {
    const username = h('input', { class: 'text-input', type: 'text', testid: 'account-username', autocomplete: 'username', maxlength: 20, required: true, 'aria-label': 'Username' });
    const password = h('input', { class: 'text-input', type: 'password', testid: 'account-password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', minlength: 10, maxlength: 200, required: true, 'aria-label': 'Password' });
    return h('form', {
      class: 'account-form',
      onSubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        busy = true;
        error = '';
        render();
        const r = await (mode === 'login' ? login : register)(username.value.trim(), password.value);
        busy = false;
        error = r.ok ? '' : r.error;
        render();
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Username'), username),
    h('label', { class: 'field' }, h('span', {}, mode === 'login' ? 'Password' : 'Password (at least 10 characters)'), password),
    error ? h('p', { class: 'form-error', role: 'alert', testid: 'account-error' }, error) : null,
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-account-submit', disabled: busy }, busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'),
      h('button', { class: 'btn', type: 'button', testid: 'btn-account-mode', onClick: () => { mode = mode === 'login' ? 'register' : 'login'; error = ''; render(); } },
        mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in')));
  }

  function render() {
    const user = currentUser();
    const synced = lastSynced();
    fill(section,
      h('h2', { id: 'account-heading' }, 'Account'),
      user
        ? [h('p', { testid: 'account-user' }, 'Signed in as ', h('strong', {}, user.username), '. Your progress syncs to every device you sign in on.'),
          h('p', { class: 'muted small', testid: 'account-synced' }, synced ? `Last synced ${synced.toLocaleTimeString()}.` : 'Syncing…'),
          h('div', { class: 'lesson-actions' },
            h('button', { class: 'btn', type: 'button', testid: 'btn-sync', onClick: () => syncNow() }, 'Sync now'),
            h('button', { class: 'btn', type: 'button', testid: 'btn-logout', onClick: () => logout() }, 'Sign out'))]
        : [h('p', { class: 'muted' }, 'Playing as a guest: progress is saved on this device. Sign in to keep it safe and use it on other devices — this device\'s progress is added to the account.'),
          form()]);
  }
  render();
  return { el: section, destroy: () => {} };
}

// This week's quests, with progress bars.
function questList(profile) {
  return h('ul', { class: 'quest-list', testid: 'quests' }, questView(profile.quests).map((q) => h('li', { class: `quest${q.done ? ' done' : ''}`, testid: `quest-${q.id}`, dataset: { done: String(q.done) } },
    h('span', { class: 'quest-text' }, h('span', { 'aria-hidden': 'true' }, q.done ? '✅ ' : '◻️ '), q.text, q.done ? h('span', { class: 'sr-only' }, ' (done)') : null),
    h('span', { class: 'muted quest-count' }, `${q.progress}/${q.target}`),
    h('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': q.text, 'aria-valuemin': 0, 'aria-valuemax': q.target, 'aria-valuenow': q.progress, 'aria-valuetext': `${q.progress} of ${q.target}` },
      h('span', { style: `width: ${Math.round((q.progress / q.target) * 100)}%` })))));
}
import { loadPuzzleStats } from '../store/puzzle-stats.js';

function rankBlock(profile) {
  const rank = rankFor(profile.xp);
  return h('div', { class: 'rank-block', testid: 'rank' },
    h('span', { class: 'rank-icon', 'aria-hidden': 'true' }, rank.icon),
    h('div', { class: 'rank-info' },
      h('strong', { testid: 'rank-name' }, rank.name),
      h('span', { class: 'muted', testid: 'xp' }, rank.next ? `${profile.xp} XP · ${rank.next.min - profile.xp} to ${rank.next.name}` : `${profile.xp} XP · top rank`),
      h('div', {
        class: 'xp-bar', role: 'progressbar', 'aria-label': 'Progress to the next rank',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(rank.progress * 100),
      }, h('span', { style: `width: ${Math.round(rank.progress * 100)}%` }))));
}

// Home-page dashboard: rank, today's puzzle, where to continue, and the record so far.
export function dashboard() {
  const profile = loadProfile();
  const today = dayKey();
  const solved = profile.daily.last === today;
  const streak = currentStreak(profile, today);
  const done = completedLessons();
  const nextLesson = ALL_LESSONS.find((l) => !done.has(l.id));
  const unlocked = ACHIEVEMENTS.filter((a) => profile.achievements[a.id]).length;
  const g = profile.games;
  const puzzles = loadPuzzleStats();
  const weak = dueToday().length;
  return h('section', { class: 'dashboard', testid: 'dashboard', 'aria-label': 'Your progress' },
    h('a', { class: 'dash-card dash-rank', href: '#/profile', testid: 'dash-profile' },
      rankBlock(profile),
      h('span', { class: 'muted' }, `🏅 ${unlocked}/${ACHIEVEMENTS.length} achievements · ${g.won}W ${g.drawn}D ${g.lost}L`)),
    canInstall() ? h('button', { class: 'dash-card dash-install', type: 'button', testid: 'dash-install', onClick: () => install() },
      h('span', { class: 'dash-eyebrow' }, 'Install the app'),
      h('strong', {}, '📲 Add OnlineChess to your device'),
      h('span', { class: 'muted' }, 'One tap to open, and it works offline')) : null,
    h('section', { class: 'dash-card dash-quests', testid: 'dash-quests', 'aria-label': 'Weekly quests' },
      h('span', { class: 'dash-eyebrow' }, `Weekly quests · 🧊 ${profile.freezes} streak freeze${profile.freezes === 1 ? '' : 's'}`),
      questList(profile),
      h('span', { class: 'muted small' }, 'Finish all three for a streak freeze. New quests every Monday.')),
    h('a', { class: `dash-card dash-daily${solved ? ' done' : ''}`, href: '#/daily', testid: 'dash-daily' },
      h('span', { class: 'dash-eyebrow' }, 'Daily puzzle'),
      h('strong', {}, solved ? 'Solved today ✓' : 'A new puzzle is waiting'),
      h('span', { class: 'muted', testid: 'dash-streak' }, streak ? `🔥 ${streak}-day streak` : 'Start a streak today')),
    h('a', { class: 'dash-card', href: '#/weak-spots', testid: 'dash-weakspots' },
      h('span', { class: 'dash-eyebrow' }, 'Weak spots'),
      h('strong', {}, weak ? `${weak} to practise today` : 'Nothing due today'),
      h('span', { class: 'muted' }, 'Your own mistakes, back as puzzles')),
    h('a', { class: 'dash-card', href: '#/campaign', testid: 'dash-campaign' },
      h('span', { class: 'dash-eyebrow' }, 'Campaign'),
      h('strong', {}, `${totalStars(profile.campaign)}/15 ★`),
      h('span', { class: 'muted' }, 'Beat the opponents in order, collect stars')),
    h('a', { class: 'dash-card', href: '#/puzzles', testid: 'dash-puzzles' },
      h('span', { class: 'dash-eyebrow' }, 'Puzzles'),
      h('strong', {}, `Puzzle rating ${puzzles.rating}`),
      h('span', { class: 'muted' }, puzzles.rushBest ? `Rush best: ${puzzles.rushBest}` : 'Try Puzzle Rush: 3 minutes, 3 strikes')),
    h('a', { class: 'dash-card', href: '#/games', testid: 'dash-games' },
      h('span', { class: 'dash-eyebrow' }, 'Your games'),
      h('strong', {}, 'Review your games'),
      h('span', { class: 'muted' }, 'See your accuracy, key moments and better moves')),
    nextLesson ? h('a', { class: 'dash-card', href: `#/learn/${nextLesson.id}`, testid: 'dash-continue' },
      h('span', { class: 'dash-eyebrow' }, 'Continue learning'),
      h('strong', {}, nextLesson.title),
      h('span', { class: 'muted' }, `${done.size}/${ALL_LESSONS.length} lessons done`)) : null);
}

export function renderProfile(outlet) {
  let cleanup = () => {};
  // Redraw everything after a reset, a sign-in or sign-out, or a sync (the numbers change);
  // keyboard focus returns to the same control, or to the page title.
  const redraw = () => {
    const focused = document.activeElement?.dataset?.testid;
    cleanup();
    outlet.replaceChildren();
    cleanup = draw(outlet, redraw);
    (outlet.querySelector(`[data-testid="${focused}"]`) ?? outlet.querySelector('[data-testid="profile-title"]'))?.focus();
  };
  cleanup = draw(outlet, redraw);
  const offs = [bus.on('account:change', redraw), bus.on('account:synced', redraw)];
  return () => { offs.forEach((off) => off()); cleanup(); };
}

// Draws the page; `redraw` draws it again after a profile reset. Returns a cleanup function.
function draw(outlet, redraw) {
  const profile = loadProfile();
  const account = accountSection();
  const g = profile.games;
  const record = (r) => (r ? `${r.w}W ${r.d}D ${r.l}L` : '—');
  const page = h('div', { class: 'page menu profile', testid: 'profile' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Profile'),
    h('h1', { tabindex: -1, testid: 'profile-title' }, 'Your profile'),
    account.el,
    currentUser() ? remindersSection() : null,
    h('section', { class: 'menu-section' }, rankBlock(profile),
      h('p', { class: 'muted' }, `Games: ${g.played} · Won ${g.won} · Drawn ${g.drawn} · Lost ${g.lost} · Checkmates ${g.mates}`),
      h('p', { class: 'muted' }, `Daily puzzle: best streak ${profile.daily.best}, solved ${profile.daily.solved} · Lessons ${profile.lessons} · Openings ${profile.openings} · Coached games ${profile.training.games} (best accuracy ${profile.training.bestAccuracy}%)`)),
    h('section', { class: 'menu-section' },
      h('h2', {}, `Weekly quests · 🧊 ${profile.freezes} streak freeze${profile.freezes === 1 ? '' : 's'}`),
      questList(profile)),
    h('section', { class: 'menu-section' },
      h('h2', {}, 'Against the computer'),
      h('table', { class: 'records', testid: 'bot-records' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Opponent'), h('th', { scope: 'col' }, 'Record'), h('th', { scope: 'col' }, 'Best streak'))),
        h('tbody', {}, PERSONAS.map((p) => h('tr', { testid: `record-${p.id}` },
          h('th', { scope: 'row' }, `${p.avatar} ${p.name}`),
          h('td', {}, record(profile.bots[p.id])),
          h('td', {}, String(profile.bots[p.id]?.best ?? 0)))))),
      h('p', { class: 'muted' }, `Online: ${record({ w: profile.online.w, d: profile.online.d, l: profile.online.l })}`)),
    h('section', { class: 'menu-section' },
      h('h2', {}, `Achievements (${Object.keys(profile.achievements).length}/${ACHIEVEMENTS.length})`),
      h('ul', { class: 'achievements', testid: 'achievements' }, ACHIEVEMENTS.map((a) => {
        const at = profile.achievements[a.id];
        return h('li', { class: `achievement${at ? ' unlocked' : ''}`, testid: `ach-${a.id}`, dataset: { unlocked: String(Boolean(at)) } },
          h('span', { class: 'ach-icon', 'aria-hidden': 'true' }, at ? a.icon : '🔒'),
          h('span', {}, h('strong', {}, a.title), h('span', { class: 'muted' }, a.text),
            at ? h('span', { class: 'sr-only' }, ' (unlocked)') : h('span', { class: 'sr-only' }, ' (locked)')));
      }))),
    h('section', { class: 'menu-section' },
      currentUser()
        ? h('p', { class: 'muted small', testid: 'reset-signed-in' }, 'Signed in: your profile is kept in your account and synced, so it cannot be reset from here. Sign out to reset this device.')
        : h('button', {
          class: 'btn', type: 'button', testid: 'btn-reset-profile',
          onClick: async () => {
            if (await confirmDialog({ title: 'Reset your profile?', message: 'This clears your XP, rank, records, achievements and streak on this device. Lesson and opening progress is kept.', confirmLabel: 'Reset', danger: true })) {
              resetProfile();
              redraw();
            }
          },
        }, 'Reset profile')));
  outlet.append(page);
  return account.destroy;
}
