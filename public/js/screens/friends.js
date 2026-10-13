// The Friends page (#/friends): your friend code, adding a friend by code or name, requests to
// answer, and your friends. Challenging a friend comes with the live channel (slices 34–35).
import { h, fill } from '../ui/dom.js';
import { currentUser } from '../store/account.js';
import { loadFriends, requestFriend, acceptFriend, declineFriend, removeFriend, setPresence } from '../store/friends.js';
import { friendStatus, liveInfo } from '../net/live.js';
import { confirmDialog } from '../ui/modal.js';
import { copyText } from '../ui/game-screen.js';
import { toast } from '../ui/toast.js';
import { bus } from '../core/events.js';

const SENT = { sent: 'Friend request sent.', friends: 'You are now friends!', already: 'You are already friends.' };

export function renderFriends(outlet) {
  const page = h('div', { class: 'page menu friends', testid: 'friends' });
  outlet.append(page);
  let data = null;
  let error = '';
  let busy = false;
  let typed = '';

  const report = (r) => { if (!r.ok) toast(r.error, { kind: 'warn' }); };

  async function refresh() {
    if (!currentUser()) { data = null; return draw(); }
    const r = await loadFriends();
    data = r.ok ? r.json : null;
    error = r.ok ? '' : r.error;
    draw();
  }

  const row = (f, ...actions) => h('li', { class: 'friend-row', testid: `friend-${f.username}` },
    h('span', { class: 'friend-name' }, h('strong', {}, f.username), h('span', { class: 'muted small' }, f.code)),
    h('span', { class: 'friend-actions' }, ...actions));
  // Online status for a friend: a dot and a word.
  function status(f) {
    const s = friendStatus(f.code);
    const [cls, word] = s.playing ? ['playing', 'In a game'] : s.online ? ['online', 'Online'] : ['offline', 'Offline'];
    return h('span', { class: `presence ${cls}`, testid: `presence-${f.username}` }, h('span', { class: 'presence-dot', 'aria-hidden': 'true' }), word);
  }
  function presenceToggle() {
    const info = liveInfo();
    if (!info) return null;
    const box = h('input', { type: 'checkbox', testid: 'show-presence', checked: info.showPresence });
    box.addEventListener('change', async () => {
      const r = await setPresence({ show: box.checked });
      if (r.ok) { info.showPresence = r.json.show; toast(r.json.show ? 'Friends can see when you are online.' : 'You now look offline to friends.'); } else { box.checked = !box.checked; toast(r.error, { kind: 'warn' }); }
    });
    return h('label', { class: 'check' }, box, ' Show friends when I am online');
  }

  function addForm() {
    const input = h('input', {
      class: 'text-input', type: 'text', testid: 'friend-input', maxlength: 20, autocomplete: 'off', autocapitalize: 'off',
      placeholder: 'OC-XXXXXX or a name', 'aria-label': 'Friend code or name', value: typed, onInput: (e) => { typed = e.target.value; },
    });
    return h('form', {
      class: 'account-form friend-add',
      onSubmit: async (e) => {
        e.preventDefault();
        if (busy || !input.value.trim()) return;
        busy = true;
        let r;
        try { r = await requestFriend(input.value); } finally { busy = false; }
        if (!r.ok) { error = r.error; draw(); return; }
        typed = '';
        error = '';
        toast(SENT[r.json.status] ?? 'Done.');
        refresh();
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Add a friend'), input),
    h('div', { class: 'lesson-actions' }, h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-add-friend' }, 'Send request')));
  }

  function draw() {
    const head = [
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/play' }, 'Play'), ' / Friends'),
      h('h1', {}, 'Friends'),
    ];
    if (!currentUser()) {
      fill(page, ...head, h('p', { testid: 'friends-signin' }, 'Friends need an account, so you can find each other on any device. ', h('a', { href: '#/profile' }, 'Sign in or create one'), ' — it takes a minute.'));
      return;
    }
    if (!data) { fill(page, ...head, error ? h('p', { class: 'form-error', role: 'alert' }, error) : h('p', { class: 'muted' }, 'Loading…')); return; }
    fill(page, ...head,
      h('section', { class: 'menu-section friend-code-box', testid: 'my-friend-code' },
        h('h2', { class: 'section-label' }, 'Your friend code'),
        h('p', { class: 'friend-code' }, h('strong', { testid: 'friend-code' }, data.code),
          h('button', { class: 'btn btn-small', type: 'button', testid: 'btn-copy-code', onClick: () => copyText(data.code, 'Friend code') }, 'Copy')),
        h('p', { class: 'muted small' }, 'Give it to a friend: they add you with it. It never changes, even if you change your name.')),
      h('section', { class: 'menu-section' }, addForm(), error ? h('p', { class: 'form-error', role: 'alert', testid: 'friends-error' }, error) : null),
      data.incoming.length ? h('section', { class: 'menu-section', testid: 'friend-requests' },
        h('h2', { class: 'section-label' }, `Requests (${data.incoming.length})`),
        h('ul', { class: 'friend-list' }, data.incoming.map((f) => row(f,
          h('button', { class: 'btn btn-primary btn-small', type: 'button', testid: `accept-${f.username}`, onClick: async () => { const r = await acceptFriend(f); toast(r.ok ? `You and ${f.username} are friends.` : r.error); refresh(); } }, 'Accept'),
          h('button', { class: 'btn btn-small', type: 'button', testid: `decline-${f.username}`, onClick: async () => { report(await declineFriend(f)); refresh(); } }, 'Decline'))))) : null,
      h('section', { class: 'menu-section', testid: 'friend-list' },
        h('h2', { class: 'section-label' }, `Friends (${data.friends.length})`),
        data.friends.length
          ? h('ul', { class: 'friend-list' }, data.friends.map((f) => row(f,
            status(f),
            h('button', {
              class: 'btn btn-small btn-danger-text', type: 'button', testid: `remove-${f.username}`,
              onClick: async () => { if (await confirmDialog({ title: `Remove ${f.username}?`, message: 'You will no longer be friends. You can add each other again later.', confirmLabel: 'Remove', danger: true })) { report(await removeFriend(f)); refresh(); } },
            }, 'Remove'))))
          : h('p', { class: 'muted' }, 'No friends yet. Share your code, or add someone by theirs.'),
        presenceToggle()),
      data.outgoing.length ? h('section', { class: 'menu-section', testid: 'friend-sent' },
        h('h2', { class: 'section-label' }, 'Waiting for an answer'),
        h('ul', { class: 'friend-list' }, data.outgoing.map((f) => row(f,
          h('button', { class: 'btn btn-small', type: 'button', testid: `cancel-${f.username}`, onClick: async () => { report(await removeFriend(f)); refresh(); } }, 'Cancel'))))) : null);
  }

  draw();
  refresh();
  // Live: statuses redraw in place; a new request or friend reloads the lists.
  const offs = [
    bus.on('account:change', refresh),
    bus.on('live:presence', draw),
    bus.on('live:hello', draw),
    bus.on('live:notice', (n) => { if (n.kind.startsWith('friend')) refresh(); }),
  ];
  return () => offs.forEach((off) => off());
}
