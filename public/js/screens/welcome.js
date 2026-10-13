// Where "Continue with Google" comes back to (#/welcome): the server has already signed this
// browser in (or says what went wrong). Load the account, offer a name to a new one, go to Profile.
import { h } from '../ui/dom.js';
import { refreshMe, markNameWanted, syncNow } from '../store/account.js';
import { navigate } from '../router.js';
import { toast } from '../ui/toast.js';

const PROBLEMS = {
  off: 'Google sign-in is not available yet.',
  busy: 'Too many sign-in attempts. Wait a minute and try again.',
  cancelled: 'Google sign-in was cancelled.',
  taken: 'That Google account\'s email already belongs to another OnlineChess account. Sign in to that one instead.',
  browser: 'Sign-in has to finish in the browser it started in. Please try again.',
  expired: 'Sign-in took too long. Please try again.',
};

export function renderWelcome(outlet, { query }) {
  outlet.append(h('div', { class: 'page menu', testid: 'welcome' }, h('p', { class: 'muted', role: 'status' }, 'Signing you in…')));
  const error = query.get('error');
  history.replaceState(null, '', `${location.pathname}#/welcome`);
  if (error) {
    toast(PROBLEMS[error] ?? 'Google sign-in did not work. Please try again.', { kind: 'warn', timeout: 6000 });
    navigate('/profile');
    return;
  }
  const isNew = query.get('new') === '1';
  refreshMe().then((user) => {
    if (user && isNew) markNameWanted();
    if (user) { toast('Signed in with Google.'); syncNow(); } else toast('Could not finish signing in. Please try again.', { kind: 'warn' });
    navigate('/profile');
  });
}
