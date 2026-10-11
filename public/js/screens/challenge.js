// A challenge from a friend (#/challenge?bot=…&moves=… or ?rush=…): what they did, and a button
// to try to beat it.
import { h } from '../ui/dom.js';
import { parseChallenge, challengeText } from '../core/challenge.js';
import { PERSONAS } from '../data/personas.js';

export function renderChallenge(outlet, { query }) {
  const c = parseChallenge(query);
  if (!c) {
    outlet.append(h('div', { class: 'page menu', testid: 'challenge' },
      h('h1', {}, 'Challenge not found'),
      h('p', {}, 'This challenge link is broken or incomplete. ', h('a', { href: '#/' }, 'Go home'), '.')));
    return null;
  }
  const persona = c.kind === 'bot' ? PERSONAS.find((p) => p.id === c.personaId) : null;
  outlet.append(h('div', { class: 'page menu challenge', testid: 'challenge', dataset: { kind: c.kind } },
    h('p', { class: 'eyebrow' }, 'You have been challenged'),
    h('h1', { class: 'challenge-title', tabindex: -1, testid: 'challenge-title' },
      h('span', { 'aria-hidden': 'true' }, persona ? `${persona.avatar} ` : '⚡ '), persona ? persona.name : 'Puzzle Rush'),
    h('p', { class: 'lede', testid: 'challenge-text' }, challengeText(c)),
    h('div', { class: 'lesson-actions' },
      h('a', {
        class: 'btn btn-primary', testid: 'btn-accept-challenge',
        href: persona ? `#/play/bot/new?persona=${persona.id}` : '#/rush',
      }, persona ? `Play ${persona.name} ▸` : 'Start Puzzle Rush ▸'),
      h('a', { class: 'btn', href: '#/' }, 'Maybe later')),
    h('p', { class: 'muted small' }, 'OnlineChess is free and runs in your browser — no sign-up needed.')));
  outlet.querySelector('[data-testid="challenge-title"]')?.focus();
  return null;
}
