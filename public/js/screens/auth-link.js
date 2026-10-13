// The page an emailed sign-in or confirmation link opens (#/auth?t=…). Opening it changes
// nothing: the link is used only when the player presses the button, so mail systems that open
// links to check them cannot use it up. The token is taken out of the address bar at once.
import { h, fill } from '../ui/dom.js';
import { useLink, currentUser } from '../store/account.js';
import { navigate } from '../router.js';
import { toast } from '../ui/toast.js';

export function renderAuthLink(outlet, { query }) {
  const token = query.get('t') ?? '';
  history.replaceState(null, '', `${location.pathname}#/auth`);
  const status = h('p', { class: 'muted', role: 'status', testid: 'auth-link-status' });
  const button = h('button', {
    class: 'btn btn-primary', type: 'button', testid: 'btn-link-signin',
    onClick: async () => {
      button.disabled = true;
      fill(status, 'Signing in…');
      const r = await useLink(token);
      if (!r.ok) { fill(status, r.error); button.disabled = false; return; }
      toast(r.emailAdded ? 'Email added.' : 'Signed in.');
      navigate('/profile');
    },
  }, 'Sign in to OnlineChess');
  const valid = /^[\w-]{40,60}$/.test(token);
  outlet.append(h('div', { class: 'page menu auth-link', testid: 'auth-link' },
    h('h1', {}, valid ? 'Sign in' : 'This link is not complete'),
    valid
      ? [h('p', {}, currentUser() ? 'Confirm with the button below.' : 'Press the button to sign in on this device.'), button, status]
      : [h('p', {}, 'Open the link from the email again, or type the 6-digit code from the email on the Profile page.'), h('a', { class: 'btn', href: '#/profile' }, 'Go to Profile')]));
}
