// The campaign map (#/campaign): the computer opponents in order, with stars to earn.
import { h } from '../ui/dom.js';
import { loadProfile } from '../store/profile.js';
import { campaignView, totalStars, STAR_RULES } from '../core/campaign.js';
import { PERSONAS } from '../data/personas.js';

function starLabel(stars) {
  const got = STAR_RULES.filter((r) => stars[r.id]);
  return `${got.length} of 3 stars${got.length ? `: ${got.map((r) => r.label.toLowerCase()).join(', ')}` : ''}`;
}

export function renderCampaign(outlet) {
  const profile = loadProfile();
  const stops = campaignView(profile.campaign);
  const total = totalStars(profile.campaign);
  outlet.append(h('div', { class: 'page menu campaign', testid: 'campaign' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/play' }, 'Normal Mode'), ' / Campaign'),
    h('h1', {}, 'Campaign'),
    h('p', { class: 'lede muted' }, `Beat each opponent to open the next. Every opponent has three stars: ${STAR_RULES.map((r) => r.label.toLowerCase()).join('; ')} (review the game to check). `,
      h('strong', { testid: 'campaign-total' }, `${total}/${PERSONAS.length * STAR_RULES.length} ★`)),
    h('ol', { class: 'campaign-path' }, stops.map(({ persona, stars, unlocked }, i) => h('li', {
      class: `campaign-stop${unlocked ? '' : ' locked'}`, testid: `stop-${persona.id}`, dataset: { unlocked: String(unlocked) },
    },
    h('span', { class: 'stop-avatar', 'aria-hidden': 'true' }, unlocked ? persona.avatar : '🔒'),
    h('div', { class: 'stop-info' },
      h('strong', {}, persona.name),
      h('span', { class: 'muted' }, `${persona.level} · ${persona.rating}`),
      h('span', { class: 'stop-stars', role: 'img', testid: `stars-${persona.id}`, 'aria-label': starLabel(stars) },
        STAR_RULES.map((r) => h('span', { class: stars[r.id] ? 'star on' : 'star', title: r.label }, stars[r.id] ? '★' : '☆')))),
    unlocked
      ? h('a', { class: 'btn btn-primary btn-small', href: `#/play/bot/new?persona=${persona.id}`, testid: `play-${persona.id}` }, 'Play ▸')
      : h('span', { class: 'muted small' }, `Beat ${stops[i - 1].persona.name} to unlock`)))),
    h('p', { class: 'muted small' }, 'Locked opponents can still be played from Normal Mode, but stars only count once the campaign reaches them. Only games from the normal starting position count.')));
}
