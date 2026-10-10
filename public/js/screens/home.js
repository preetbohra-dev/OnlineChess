// Home and mode menus: Normal Mode (Against Person / Against Computer) and Training Mode.
import { h } from '../ui/dom.js';
import { PERSONAS } from '../data/personas.js';

function optionCard({ testid, href, icon, title, eyebrow, text, soon = false }) {
  const content = [
    h('span', { class: 'option-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'option-text' },
      eyebrow ? h('span', { class: 'option-eyebrow' }, eyebrow) : null,
      h('strong', {}, title),
      h('span', { class: 'muted' }, text)),
    soon ? h('span', { class: 'badge' }, 'Coming soon') : h('span', { class: 'option-go', 'aria-hidden': 'true' }, '→'),
  ];
  return soon
    ? h('div', { class: 'option-card disabled', testid, 'aria-disabled': 'true' }, content)
    : h('a', { class: 'option-card', testid, href }, content);
}

export function renderHome(outlet) {
  outlet.append(h('div', { class: 'page home' },
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, 'Play · Learn · Improve'),
      h('h1', {}, 'Your next move starts here.'),
      h('p', { class: 'lede' }, 'Challenge a friend, outwit a computer that talks back, or train with a coach that explains every move — from your first game to grandmaster ideas.')),
    h('div', { class: 'mode-grid' },
      h('a', { class: 'mode-tile mode-normal', href: '#/play', testid: 'mode-normal' },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, '♞'),
        h('h2', {}, 'Normal Mode'),
        h('p', {}, 'Play a full game against a friend — on this device or online — or against the computer at five levels.'),
        h('span', { class: 'mode-cta' }, 'Play now →')),
      h('a', { class: 'mode-tile mode-training', href: '#/train', testid: 'mode-training' },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, '♛'),
        h('h2', {}, 'Training Mode'),
        h('p', {}, 'Learn the rules, tactics, openings and endgames, and get feedback on every move you make.'),
        h('span', { class: 'mode-cta' }, 'Start learning →'))),
    h('footer', { class: 'credits muted' },
      'Computer opponents are powered by ', h('a', { href: 'https://stockfishchess.org', rel: 'noopener', target: '_blank' }, 'Stockfish'),
      ', free software under the ', h('a', { href: '/vendor/stockfish/Copying.txt' }, 'GNU GPL v3'), '.')));
}

export function renderPlayMenu(outlet) {
  outlet.append(h('div', { class: 'page menu' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Normal Mode'),
    h('h1', {}, 'Normal Mode'),
    h('section', { class: 'menu-section' },
      h('h2', {}, 'Against a person'),
      h('div', { class: 'option-list' },
        optionCard({ testid: 'opt-local', href: '#/play/local/new', icon: '🤝', title: 'Same device', text: 'Pass and play on this screen.' }),
        optionCard({ testid: 'opt-online', href: '#/play/online/new', icon: '🌐', title: 'Online with a friend', text: 'Share a link and play from anywhere.' }))),
    h('section', { class: 'menu-section' },
      h('h2', {}, 'Against the computer'),
      h('div', { class: 'option-list', testid: 'opt-computer' },
        PERSONAS.map((p) => optionCard({ testid: `opt-bot-${p.id}`, href: `#/play/bot/new?persona=${p.id}`, icon: p.avatar, eyebrow: `${p.level} · ${p.rating}`, title: p.name, text: p.tagline }))))));
}

export function renderTrainMenu(outlet) {
  const items = [
    ['🧑‍🏫', 'Coached game', 'Play while a coach grades every move and explains what you missed.'],
    ['📚', 'Lessons', 'From how the pieces move to grandmaster studies.'],
    ['📖', 'Openings', 'Learn the ideas behind 15 classic openings.'],
    ['⚖️', 'Rules handbook', 'Every rule of chess, explained with examples.'],
  ];
  outlet.append(h('div', { class: 'page menu' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Training Mode'),
    h('h1', {}, 'Training Mode'),
    h('div', { class: 'option-list' }, items.map(([icon, title, text]) => optionCard({ icon, title, text, soon: true })))));
}

export function renderNotFound(outlet) {
  outlet.append(h('div', { class: 'page menu' },
    h('h1', {}, 'Page not found'),
    h('p', {}, h('a', { href: '#/' }, 'Back to home'))));
}
