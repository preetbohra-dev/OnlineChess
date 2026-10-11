// The profile page (rank, XP, records, achievements) and the dashboard shown on the home page.
import { h } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { loadProfile, resetProfile } from '../store/profile.js';
import { rankFor, ACHIEVEMENTS, currentStreak, dayKey } from '../core/progression.js';
import { dailyPuzzle, dailyTier } from '../core/daily.js';
import { PERSONAS } from '../data/personas.js';
import { ALL_LESSONS } from '../data/lessons/index.js';
import { completedLessons } from '../store/progress.js';

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
  return h('section', { class: 'dashboard', testid: 'dashboard', 'aria-label': 'Your progress' },
    h('a', { class: 'dash-card dash-rank', href: '#/profile', testid: 'dash-profile' },
      rankBlock(profile),
      h('span', { class: 'muted' }, `🏅 ${unlocked}/${ACHIEVEMENTS.length} achievements · ${g.won}W ${g.drawn}D ${g.lost}L`)),
    h('a', { class: `dash-card dash-daily${solved ? ' done' : ''}`, href: '#/daily', testid: 'dash-daily' },
      h('span', { class: 'dash-eyebrow' }, 'Daily puzzle'),
      h('strong', {}, solved ? 'Solved today ✓' : dailyPuzzle(today, dailyTier(profile.xp)).title),
      h('span', { class: 'muted', testid: 'dash-streak' }, streak ? `🔥 ${streak}-day streak` : 'Start a streak today')),
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
  const profile = loadProfile();
  const g = profile.games;
  const record = (r) => (r ? `${r.w}W ${r.d}D ${r.l}L` : '—');
  const page = h('div', { class: 'page menu profile', testid: 'profile' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Profile'),
    h('h1', { tabindex: -1, testid: 'profile-title' }, 'Your profile'),
    h('section', { class: 'menu-section' }, rankBlock(profile),
      h('p', { class: 'muted' }, `Games: ${g.played} · Won ${g.won} · Drawn ${g.drawn} · Lost ${g.lost} · Checkmates ${g.mates}`),
      h('p', { class: 'muted' }, `Daily puzzle: best streak ${profile.daily.best}, solved ${profile.daily.solved} · Lessons ${profile.lessons} · Openings ${profile.openings} · Coached games ${profile.training.games} (best accuracy ${profile.training.bestAccuracy}%)`)),
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
      h('button', {
        class: 'btn', type: 'button', testid: 'btn-reset-profile',
        onClick: async () => {
          if (await confirmDialog({ title: 'Reset your profile?', message: 'This clears your XP, rank, records, achievements and streak on this device. Lesson and opening progress is kept.', confirmLabel: 'Reset', danger: true })) {
            resetProfile();
            outlet.replaceChildren();
            renderProfile(outlet);
            outlet.querySelector('[data-testid="profile-title"]')?.focus();
          }
        },
      }, 'Reset profile')));
  outlet.append(page);
}
