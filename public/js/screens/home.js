// Home and mode menus: Normal Mode (Against Person / Against Computer) and Training Mode.
import { h } from '../ui/dom.js';
import { PERSONAS } from '../data/personas.js';
import { today } from './profile.js';
import { loadProfile } from '../store/profile.js';

// The complete source (GPL-3.0, as Stockfish requires for anything that bundles it).
export const SOURCE_URL = 'https://github.com/preetbohra-dev/OnlineChess';

// A menu entry: icon, title and one line of text.
function tile({ testid, href, icon, title, text, eyebrow }) {
  return h('a', { class: 'tile', testid, href },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'tile-text' },
      eyebrow ? h('span', { class: 'tile-eyebrow' }, eyebrow) : null,
      h('strong', {}, title),
      text ? h('span', { class: 'muted' }, text) : null));
}

const section = (title, testid, ...items) => h('section', { class: 'menu-section', testid },
  h('h2', { class: 'section-label' }, title),
  h('div', { class: 'tile-grid' }, items));

export function renderHome(outlet) {
  const profile = loadProfile();
  const returning = profile.xp > 0 || profile.games.played > 0;
  outlet.append(h('div', { class: 'page home' },
    h('section', { class: 'home-head' },
      h('h1', {}, returning ? 'Good to see you.' : 'Your next move starts here.'),
      returning ? null : h('p', { class: 'lede' }, 'Play a friend or the computer, solve puzzles, and train with a coach that explains every move.')),
    h('div', { class: 'home-actions' },
      h('a', { class: 'mode-btn', href: '#/play', testid: 'mode-normal' },
        h('span', { class: 'mode-btn-icon', 'aria-hidden': 'true' }, '♞'),
        h('span', {}, h('strong', {}, 'Play a game'), h('span', { class: 'muted' }, 'A friend, online, or the computer'))),
      h('a', { class: 'mode-btn training', href: '#/train', testid: 'mode-training' },
        h('span', { class: 'mode-btn-icon', 'aria-hidden': 'true' }, '♛'),
        h('span', {}, h('strong', {}, 'Train'), h('span', { class: 'muted' }, 'Puzzles, lessons, openings, a coach')))),
    today(),
    h('footer', { class: 'credits muted' },
      'Computer opponents are powered by ', h('a', { href: 'https://stockfishchess.org', rel: 'noopener', target: '_blank' }, 'Stockfish'),
      ', free software under the ', h('a', { href: '/vendor/stockfish/Copying.txt' }, 'GNU GPL v3'), '. ',
      h('a', { href: SOURCE_URL, rel: 'noopener', target: '_blank', testid: 'source-link' }, 'Source code'), ' · ',
      h('a', { href: '/privacy.html', testid: 'footer-privacy' }, 'Privacy'), ' · ',
      h('a', { href: '/support.html', testid: 'footer-support' }, 'Support'))));
}

export function renderPlayMenu(outlet) {
  outlet.append(h('div', { class: 'page menu' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Play'),
    h('h1', {}, 'Play'),
    section('Against a person', 'play-person',
      tile({ testid: 'opt-local', href: '#/play/local/new', icon: '🤝', title: 'Same device', text: 'Pass and play on this screen' }),
      tile({ testid: 'opt-online', href: '#/play/online/new', icon: '🌐', title: 'Online with a friend', text: 'Share a link, play from anywhere' })),
    section('Against the computer', 'opt-computer',
      tile({ testid: 'opt-campaign', href: '#/campaign', icon: '★', title: 'Campaign', text: 'Beat them in order, earn stars' }),
      PERSONAS.map((p) => tile({ testid: `opt-bot-${p.id}`, href: `#/play/bot/new?persona=${p.id}`, icon: p.avatar, eyebrow: `${p.level} · ${p.rating}`, title: p.name }))),
    section('Your games', 'play-games',
      tile({ testid: 'opt-games', href: '#/games', icon: '↺', title: 'Review your games', text: 'Accuracy, key moments, better moves' }))));
}

export function renderTrainMenu(outlet) {
  outlet.append(h('div', { class: 'page menu' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Train'),
    h('h1', {}, 'Train'),
    section('Practise', 'train-practise',
      tile({ testid: 'opt-puzzles', href: '#/puzzles', icon: '🧩', title: 'Rated puzzles', text: 'Matched to your rating' }),
      tile({ testid: 'opt-rush', href: '#/rush', icon: '⚡', title: 'Puzzle Rush', text: 'Three minutes, three strikes' }),
      tile({ testid: 'opt-daily', href: '#/daily', icon: '📅', title: 'Daily puzzle', text: 'One a day — keep your streak' }),
      tile({ testid: 'opt-weakspots', href: '#/weak-spots', icon: '🎯', title: 'Weak spots', text: 'Your own mistakes, until mastered' })),
    section('Learn', 'train-learn',
      tile({ testid: 'opt-lessons', href: '#/learn', icon: '📚', title: 'Lessons', text: 'From the pieces to endgame studies' }),
      tile({ testid: 'opt-openings', href: '#/openings', icon: '📖', title: 'Openings', text: '15 classic openings, move by move' }),
      tile({ testid: 'opt-rules', href: '#/rules', icon: '⚖️', title: 'Rules handbook', text: 'Every rule, with diagrams' })),
    section('Play and compete', 'train-play',
      tile({ testid: 'opt-coach', href: '#/train/coach', icon: '🧑‍🏫', title: 'Coached game', text: 'A coach explains every move' }),
      tile({ testid: 'opt-weekly', href: '#/weekly', icon: '🏆', title: 'Weekly challenge', text: 'Same puzzles for all, one leaderboard' }))));
}

export function renderNotFound(outlet) {
  outlet.append(h('div', { class: 'page menu' },
    h('h1', {}, 'Page not found'),
    h('p', {}, h('a', { href: '#/' }, 'Back to home'))));
}
