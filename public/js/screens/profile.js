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
import { dueToday, loadDeck } from '../store/weakspots.js';
import { canInstall, install } from '../ui/pwa.js';
import { currentUser } from '../store/account.js';
import { accountSection } from '../ui/account-panel.js';
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
      h('h2', { class: 'section-label', id: 'reminders-heading' }, 'Daily reminder'),
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
// This week's quests, with progress bars.
function questList(profile) {
  return h('ul', { class: 'quest-list', testid: 'quests' }, questView(profile.quests).map((q) => h('li', { class: `quest${q.done ? ' done' : ''}`, testid: `quest-${q.id}`, dataset: { done: String(q.done) } },
    h('span', { class: 'quest-text' }, h('span', { class: `quest-check${q.done ? ' done' : ''}`, 'aria-hidden': 'true' }, q.done ? '✓' : ''), q.text, q.done ? h('span', { class: 'sr-only' }, ' (done)') : null),
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

// The home page's "Today" panel: the daily puzzle and streak, this week's quests, weak spots due,
// one clear next step, and a few shortcuts to carry on where you left off.
export function today() {
  const profile = loadProfile();
  const day = dayKey();
  const solved = profile.daily.last === day;
  const streak = currentStreak(profile, day);
  const done = completedLessons();
  const nextLesson = ALL_LESSONS.find((l) => !done.has(l.id));
  const puzzles = loadPuzzleStats();
  const deck = loadDeck();
  const weak = dueToday().length;
  const freezes = `🧊 ${profile.freezes} streak freeze${profile.freezes === 1 ? '' : 's'}`;
  return h('section', { class: 'today', testid: 'dashboard', 'aria-labelledby': 'today-heading' },
    h('div', { class: 'today-panel' },
      h('h2', { class: 'section-label', id: 'today-heading' }, 'Today'),
      h('a', { class: `today-row${solved ? ' done' : ''}`, href: '#/daily', testid: 'dash-daily' },
        h('span', { class: 'today-icon', 'aria-hidden': 'true' }, solved ? '✓' : '🧩'),
        h('span', { class: 'today-main' }, h('strong', {}, 'Daily puzzle'), h('span', { class: 'muted' }, solved ? 'Solved today' : 'A new puzzle is waiting')),
        h('span', { class: 'today-side', testid: 'dash-streak' }, streak ? `🔥 ${streak}-day streak` : 'Start a streak today')),
      deck.length ? h('a', { class: 'today-row', href: '#/weak-spots', testid: 'dash-weakspots' },
        h('span', { class: 'today-icon', 'aria-hidden': 'true' }, '🎯'),
        h('span', { class: 'today-main' }, h('strong', {}, 'Weak spots'), h('span', { class: 'muted' }, weak ? `${weak} to practise today` : 'Nothing due today'))) : null,
      h('div', { class: 'today-quests', testid: 'dash-quests' },
        h('div', { class: 'today-quests-head' }, h('strong', {}, 'Weekly quests'), h('span', { class: 'muted small' }, freezes)),
        questList(profile)),
      h('a', { class: 'btn btn-primary today-cta', href: solved ? '#/rush' : '#/daily', testid: 'today-cta' }, solved ? 'Try Puzzle Rush →' : 'Solve today\'s puzzle →')),
    h('nav', { class: 'shortcuts', 'aria-label': 'Carry on' },
      nextLesson ? h('a', { class: 'chip', href: `#/learn/${nextLesson.id}`, testid: 'dash-continue' }, `📚 ${nextLesson.title}`) : null,
      h('a', { class: 'chip', href: '#/puzzles', testid: 'dash-puzzles' }, `🧩 Puzzles · ${puzzles.rating}`),
      h('a', { class: 'chip', href: '#/weekly', testid: 'dash-weekly' }, '🏆 Weekly challenge'),
      canInstall() ? h('button', { class: 'chip', type: 'button', testid: 'dash-install', onClick: () => install() }, '📲 Install the app') : null));
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
  const unlocked = ACHIEVEMENTS.filter((a) => profile.achievements[a.id]);
  const locked = ACHIEVEMENTS.filter((a) => !profile.achievements[a.id]);
  const achievement = (a) => {
    const at = profile.achievements[a.id];
    return h('li', { class: `achievement${at ? ' unlocked' : ''}`, testid: `ach-${a.id}`, dataset: { unlocked: String(Boolean(at)) } },
      h('span', { class: 'ach-icon', 'aria-hidden': 'true' }, at ? a.icon : '🔒'),
      h('span', {}, h('strong', {}, a.title), h('span', { class: 'muted' }, a.text),
        h('span', { class: 'sr-only' }, at ? ' (unlocked)' : ' (locked)')));
  };
  const stat = (label, value) => h('div', { class: 'stat' }, h('strong', {}, String(value)), h('span', { class: 'muted' }, label));
  const page = h('div', { class: 'page menu profile', testid: 'profile' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Profile'),
    h('h1', { tabindex: -1, testid: 'profile-title' }, 'Your profile'),
    h('section', { class: 'menu-section profile-overview' },
      rankBlock(profile),
      h('div', { class: 'stats' },
        stat('games', g.played),
        stat('wins', g.won),
        stat('puzzle rating', loadPuzzleStats().rating),
        stat('best daily streak', profile.daily.best),
        stat('campaign stars', `${totalStars(profile.campaign)}/15`),
        stat('achievements', `${unlocked.length}/${ACHIEVEMENTS.length}`)),
      h('div', { class: 'profile-quests' },
        h('h2', { class: 'section-label' }, `This week's quests · 🧊 ${profile.freezes} streak freeze${profile.freezes === 1 ? '' : 's'}`),
        questList(profile))),
    h('section', { class: 'menu-section' },
      h('h2', { class: 'section-label' }, 'Against the computer'),
      h('table', { class: 'records', testid: 'bot-records' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Opponent'), h('th', { scope: 'col' }, 'Record'), h('th', { scope: 'col' }, 'Best streak'))),
        h('tbody', {}, PERSONAS.map((p) => h('tr', { testid: `record-${p.id}` },
          h('th', { scope: 'row' }, `${p.avatar} ${p.name}`),
          h('td', {}, record(profile.bots[p.id])),
          h('td', {}, String(profile.bots[p.id]?.best ?? 0)))))),
      h('p', { class: 'muted small' }, `Online: ${record({ w: profile.online.w, d: profile.online.d, l: profile.online.l })} · `, h('a', { href: '#/games' }, 'Review your games'))),
    h('section', { class: 'menu-section', testid: 'achievements' },
      h('h2', { class: 'section-label' }, `Achievements · ${unlocked.length} of ${ACHIEVEMENTS.length}`),
      unlocked.length ? h('ul', { class: 'achievements' }, unlocked.map(achievement)) : h('p', { class: 'muted' }, 'None yet — win a game or solve a puzzle to earn your first.'),
      h('details', { class: 'locked-achievements' },
        h('summary', {}, `Still to unlock (${locked.length})`),
        h('ul', { class: 'achievements' }, locked.map(achievement)))),
    account.el,
    currentUser() ? remindersSection() : null,
    h('section', { class: 'menu-section' },
      currentUser()
        ? h('p', { class: 'muted small', testid: 'reset-signed-in' }, 'Signed in: your profile is kept in your account and synced, so it cannot be reset from here. Sign out to reset this device.')
        : h('button', {
          class: 'btn btn-small', type: 'button', testid: 'btn-reset-profile',
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
