// The Account part of the profile page. Signed out: sign in with an emailed code (no password
// needed), with a password, or create an account; "forgot password" is an emailed code plus a
// new password. Signed in: the name, the email (or a prompt to add one), password, sign-out and
// deleting the account.
import { h, fill } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import {
  currentUser, lastSynced, login, logout, syncNow, deleteAccount,
  signUpWithEmail, requestCode, useCode, addEmail, loadAccount, changePassword, rename, nameWanted, nameChosen, loadProviders, googleLinkUrl, signInWithGoogleInApp,
} from '../store/account.js';
import { isNativeApp } from '../net/platform.js';

// Google's "G", in its own colours (Google's sign-in button guidelines).
const GOOGLE_G = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
function googleButton(href, label, testid) {
  const a = h('a', { class: 'btn btn-google', href, testid });
  a.innerHTML = GOOGLE_G; // a fixed, trusted image
  a.append(h('span', {}, label));
  return a;
}

const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('span', { class: 'muted small' }, hint) : null);

export function accountSection() {
  const section = h('section', { class: 'menu-section account', testid: 'account', 'aria-labelledby': 'account-heading' });
  // Signed out: 'start' | 'password' | 'signup' | 'forgot' | 'code'. Signed in: null | 'name' |
  // 'password' | 'email' | 'email-code'.
  let mode = 'start';
  let error = '';
  let info = '';
  let busy = false;
  let email = ''; // the address a code was sent to
  let forgot = false; // the code also sets a new password
  let details = null; // { username, email, hasPassword } once loaded
  let askName = false; // just created: suggest choosing a name
  let loadedFor = null;
  let confirming = false; // the code confirms a new sign-up: a password may be chosen with it
  let google = false; // the server offers "Continue with Google"
  loadProviders().then((p) => { if (p.google) { google = true; render(); } });
  const typed = {}; // what the player typed, by field, kept when the form is drawn again
  // An input that keeps its value across redraws (passwords included, within this panel only).
  const input = (props) => h('input', { class: 'text-input', ...props, value: typed[props.testid] ?? props.value ?? '', onInput: (e) => { typed[props.testid] = e.target.value; } });

  const go = (next, { keepInfo = false } = {}) => {
    mode = next;
    error = '';
    if (!keepInfo) info = '';
    for (const k of Object.keys(typed)) if (!/email/.test(k)) delete typed[k];
    render();
  };
  async function run(task) {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try { await task(); } finally {
      busy = false;
      render();
      // After a mistake, back to the first field so it can be corrected straight away.
      if (error) requestAnimationFrame(() => section.querySelector('input:not([type="checkbox"])')?.focus());
    }
  }
  const submit = (task) => (e) => { e.preventDefault(); run(task); };
  const messages = () => [
    error ? h('p', { class: 'form-error', role: 'alert', testid: 'account-error' }, error) : null,
    info ? h('p', { class: 'muted', role: 'status', testid: 'account-info' }, info) : null,
  ];
  const back = (to = 'start') => h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-back', onClick: () => go(to) }, 'Back');

  // --- Signed out ---------------------------------------------------------------------------
  function startForm() {
    const emailInput = input({ type: 'email', testid: 'account-email', autocomplete: 'email', required: true, maxlength: 254, 'aria-label': 'Email', value: email });
    const form = h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        email = emailInput.value.trim();
        const r = await requestCode(email);
        if (!r.ok) { error = r.error; return; }
        info = `We sent a 6-digit code to ${email}. It works for 15 minutes.`;
        mode = 'code';
      }),
    },
    field(forgot ? 'Your email' : 'Email', emailInput, forgot ? 'We\'ll send a code; then choose a new password.' : 'No password needed: we\'ll email you a code.'),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-email-code', disabled: busy }, busy ? 'Sending…' : 'Email me a code'),
      forgot ? back() : null),
    forgot ? null : h('p', { class: 'account-alt' },
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-use-password', onClick: () => go('password') }, 'Sign in with a password'),
      ' · ',
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-create-account', onClick: () => go('signup') }, 'Create an account')));
    if (!google || forgot) return form;
    const googleStart = googleButton('/auth/google/start', 'Continue with Google', 'btn-google');
    if (isNativeApp()) {
      // Inside the app: the phone's browser, and back (see net/native.js).
      googleStart.addEventListener('click', (e) => {
        e.preventDefault();
        run(async () => {
          const r = await signInWithGoogleInApp();
          if (!r.ok && !r.cancelled) error = r.error;
        });
      });
    }
    return h('div', { class: 'account-start' },
      googleStart,
      h('p', { class: 'or-line', 'aria-hidden': 'true' }, h('span', {}, 'or')),
      form);
  }

  function passwordForm() {
    const who = input({ type: 'text', testid: 'account-username', autocomplete: 'username', required: true, maxlength: 254, 'aria-label': 'Email or username', value: email });
    const password = input({ type: 'password', testid: 'account-password', autocomplete: 'current-password', required: true, maxlength: 200, 'aria-label': 'Password' });
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        email = who.value.trim();
        const r = await login(email, password.value);
        if (!r.ok) { error = r.error; requestAnimationFrame(() => section.querySelector('[data-testid="account-password"]')?.focus()); }
      }),
    },
    field('Email or username', who),
    field('Password', password),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-account-submit', disabled: busy }, busy ? 'Please wait…' : 'Sign in'),
      back()),
    h('p', { class: 'account-alt' }, h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-forgot', onClick: () => { forgot = true; go('forgot'); } }, 'Forgot your password?')));
  }

  function signupForm() {
    const emailInput = input({ type: 'email', testid: 'signup-email', autocomplete: 'email', required: true, maxlength: 254, 'aria-label': 'Email', value: email });
    const name = input({ type: 'text', testid: 'signup-name', autocomplete: 'nickname', required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_\\-]{3,20}', 'aria-label': 'Name on the leaderboard' });
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        email = emailInput.value.trim();
        const r = await signUpWithEmail(email, name.value.trim());
        if (!r.ok) { error = r.error; return; }
        forgot = false;
        confirming = true;
        info = `Almost done: we sent a 6-digit code to ${email}. Enter it to confirm your email.`;
        mode = 'code';
      }),
    },
    field('Email', emailInput),
    field('Name', name, 'Shown on the weekly leaderboard. 3–20 letters, digits, - or _.'),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-signup-submit', disabled: busy }, busy ? 'Please wait…' : 'Create account'),
      back()));
  }

  function codeForm() {
    const code = input({ type: 'text', testid: 'account-code', inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true, 'aria-label': '6-digit code' });
    const password = forgot || confirming
      ? input({ type: 'password', testid: 'account-new-password', autocomplete: 'new-password', minlength: 10, maxlength: 200, required: forgot, 'aria-label': forgot ? 'New password' : 'Password (optional)' })
      : null;
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        const r = await useCode(email, code.value.trim(), password?.value || undefined);
        if (!r.ok) { error = r.error; return; }
        forgot = false; // signed in: the page draws a new panel, which offers a name if the account is new
        confirming = false;
        if (!r.created) toast('Signed in.');
      }),
    },
    field('6-digit code', code),
    password ? field(forgot ? 'New password' : 'Password (optional)', password, forgot ? 'At least 10 characters.' : 'At least 10 characters. Without one, you sign in with an emailed code.') : null,
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-code-submit', disabled: busy }, busy ? 'Checking…' : forgot ? 'Set password and sign in' : 'Continue'),
      h('button', {
        class: 'btn', type: 'button', testid: 'btn-resend', disabled: busy,
        onClick: () => run(async () => { const r = await requestCode(email); info = r.ok ? `We sent a new code to ${email}.` : ''; if (!r.ok) error = r.error; }),
      }, 'Send a new code'),
      back()));
  }

  // --- Signed in ----------------------------------------------------------------------------
  function nameForm(user) {
    const name = input({ type: 'text', testid: 'rename-input', autocomplete: 'nickname', required: true, minlength: 3, maxlength: 20, value: user.username, 'aria-label': 'Name' });
    return h('form', {
      class: 'account-form', testid: 'name-form',
      onSubmit: submit(async () => {
        const r = await rename(name.value.trim());
        if (!r.ok) { error = r.error; return; }
        askName = false;
        details = null;
        mode = null;
        toast('Name saved.');
      }),
    },
    field(askName ? 'Welcome! Choose the name others see' : 'Name', name, '3–20 letters, digits, - or _.'),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-rename', disabled: busy }, busy ? 'Saving…' : 'Save name'),
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-back', onClick: () => { askName = false; nameChosen(); go(null); } }, askName ? 'Keep this one' : 'Cancel')));
  }

  // Proof that it is the player: the current password, or for an account without one a code
  // sent to its email. -> { el, value() }
  function proofField(testid) {
    if (details?.hasPassword) {
      const pw = input({ type: 'password', testid, autocomplete: 'current-password', required: true, maxlength: 200, 'aria-label': 'Current password' });
      return { el: field('Current password', pw), value: () => ({ current: pw.value, password: pw.value }) };
    }
    const code = input({ type: 'text', testid, inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', maxlength: 6, required: true, 'aria-label': 'Code from your email' });
    const send = h('button', {
      class: 'btn btn-small', type: 'button', testid: `${testid}-send`,
      onClick: () => run(async () => { const r = await requestCode(details.email); if (r.ok) info = `We sent a code to ${details.email}.`; else error = r.error; }),
    }, 'Email me a code');
    return { el: h('div', {}, field('Code from your email', code, `Confirm it is you: we send it to ${details?.email ?? 'your email'}.`), send), value: () => ({ code: code.value.trim() }) };
  }

  function passwordChangeForm() {
    const proof = proofField('pw-current');
    const next = input({ type: 'password', testid: 'pw-new', autocomplete: 'new-password', required: true, minlength: 10, maxlength: 200, 'aria-label': 'New password' });
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        const p = proof.value();
        const r = await changePassword(p.current, next.value, p.code);
        if (!r.ok) { error = r.error; return; }
        details = null;
        mode = null;
        toast('Password saved. Other devices were signed out.');
      }),
    },
    proof.el,
    field(details?.hasPassword ? 'New password' : 'Password', next, 'At least 10 characters.'),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-pw-save', disabled: busy }, busy ? 'Saving…' : 'Save password'),
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-back', onClick: () => go(null) }, 'Cancel')));
  }

  function emailForm() {
    const emailInput = input({ type: 'email', testid: 'add-email-input', autocomplete: 'email', required: true, maxlength: 254, 'aria-label': 'New email' });
    const proof = proofField('add-email-proof');
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        email = emailInput.value.trim();
        const r = await addEmail(email, proof.value());
        if (!r.ok) { error = r.error; return; }
        info = `We sent a 6-digit code to ${email}.`;
        mode = 'email-code';
      }),
    },
    field(details?.email ? 'New email' : 'Email', emailInput, 'So you can always get back into your account.'),
    proof.el,
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-add-email', disabled: busy }, busy ? 'Sending…' : 'Send code'),
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-back', onClick: () => go(null) }, 'Cancel')));
  }

  function emailCodeForm() {
    const code = input({ type: 'text', testid: 'add-email-code', inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', maxlength: 6, required: true, 'aria-label': '6-digit code' });
    return h('form', {
      class: 'account-form',
      onSubmit: submit(async () => {
        const r = await useCode(email, code.value.trim());
        if (!r.ok) { error = r.error; return; }
        details = null;
        mode = null;
        toast('Email added.');
      }),
    },
    field('6-digit code', code),
    ...messages(),
    h('div', { class: 'lesson-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit', testid: 'btn-add-email-confirm', disabled: busy }, busy ? 'Checking…' : 'Confirm'),
      h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-back', onClick: () => go(null) }, 'Cancel')));
  }

  function signedIn(user) {
    if (loadedFor !== user.username || !details) {
      loadedFor = user.username;
      loadAccount().then((r) => { if (r.ok) { details = r.json; render(); } });
    }
    if (askName && mode === 'name') return [nameForm(user)];
    const synced = lastSynced();
    const view = [
      h('p', { testid: 'account-user' }, 'Signed in as ', h('strong', {}, user.username), '. Your progress syncs to every device you sign in on.'),
      details?.email
        ? h('p', { class: 'muted small', testid: 'account-email-line' }, `Email: ${details.email} `, h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-change-email', onClick: () => go('email') }, 'Change'))
        : details ? h('p', { class: 'account-nudge', testid: 'add-email-nudge' }, 'Add an email so you can always get back into this account. ',
          h('button', { class: 'btn btn-link', type: 'button', testid: 'btn-add-email-open', onClick: () => go('email') }, 'Add email')) : null,
      details?.google ? h('p', { class: 'muted small', testid: 'google-linked' }, 'Google account connected: you can sign in with Google.')
        : google && details && !isNativeApp() ? h('p', {}, (() => {
          const b = googleButton('/auth/google/start', 'Connect Google', 'btn-google-link');
          b.addEventListener('click', async (e) => {
            e.preventDefault();
            const r = await googleLinkUrl();
            if (r.ok) location.assign(r.json.url); else toast(r.error, { kind: 'warn' });
          });
          return b;
        })()) : null,
      h('p', { class: 'muted small', testid: 'account-synced' }, synced ? `Last synced ${synced.toLocaleTimeString()}.` : 'Syncing…'),
    ];
    if (mode === 'name') view.push(nameForm(user));
    else if (mode === 'password') view.push(passwordChangeForm());
    else if (mode === 'email') view.push(emailForm());
    else if (mode === 'email-code') view.push(emailCodeForm());
    else {
      view.push(h('div', { class: 'lesson-actions' },
        h('button', { class: 'btn', type: 'button', testid: 'btn-sync', onClick: () => syncNow() }, 'Sync now'),
        h('button', { class: 'btn', type: 'button', testid: 'btn-rename-open', onClick: () => go('name') }, 'Change name'),
        h('button', { class: 'btn', type: 'button', testid: 'btn-password-open', onClick: () => go('password') }, details?.hasPassword === false ? 'Set a password' : 'Change password'),
        h('button', { class: 'btn', type: 'button', testid: 'btn-logout', onClick: () => logout() }, 'Sign out'),
        h('button', { class: 'btn btn-small btn-danger-text', type: 'button', testid: 'btn-delete-account', onClick: () => confirmDelete(user.username, details) }, 'Delete account')));
    }
    return view;
  }

  function render() {
    const user = currentUser();
    if (user && nameWanted() && !askName) { askName = true; mode = 'name'; }
    if (!user && mode !== null && !['start', 'password', 'signup', 'forgot', 'code'].includes(mode)) mode = 'start';
    if (!user && mode === null) mode = 'start';
    if (user && ['start', 'password', 'signup', 'forgot', 'code'].includes(mode)) mode = askName ? 'name' : null;
    if (!user) { details = null; loadedFor = null; }
    const signedOut = () => {
      if (mode === 'password') return [passwordForm()];
      if (mode === 'signup') return [signupForm()];
      if (mode === 'code') return [codeForm()];
      if (mode !== 'forgot') forgot = false;
      if (mode === 'start') confirming = false;
      return [h('p', { class: 'muted' }, 'Playing as a guest: progress is saved on this device. Sign in to keep it safe and use it on other devices — this device\'s progress is added to the account.'), startForm()];
    };
    fill(section,
      h('h2', { class: 'section-label', id: 'account-heading' }, 'Account'),
      user ? signedIn(user) : signedOut());
  }
  render();
  return { el: section, destroy: () => {} };
}

// Deleting the account asks for the password, or for an account without one a code sent to its
// email (so a borrowed, signed-in phone cannot do it).
function confirmDelete(username, details) {
  const withCode = details?.hasPassword === false;
  const secret = withCode
    ? h('input', { class: 'text-input', type: 'text', testid: 'delete-code', inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', maxlength: 6, 'aria-label': '6-digit code' })
    : h('input', { class: 'text-input', type: 'password', testid: 'delete-password', autocomplete: 'current-password', maxlength: 200, 'aria-label': 'Password' });
  const clear = h('input', { type: 'checkbox', testid: 'delete-clear-device' });
  const error = h('p', { class: 'form-error', role: 'alert', testid: 'delete-error', hidden: true });
  const sendCode = withCode ? h('button', {
    class: 'btn btn-small', type: 'button', testid: 'btn-delete-send-code',
    onClick: async () => { const r = await requestCode(details.email); toast(r.ok ? `We sent a code to ${details.email}.` : r.error); },
  }, 'Email me a code') : null;
  let busy = false;
  const modal = openModal({
    title: 'Delete your account?',
    testid: 'delete-account-dialog',
    body: [
      h('p', {}, 'This permanently deletes the account ', h('strong', {}, username), ', its synced progress, reminders and weekly challenge scores. It cannot be undone.'),
      withCode ? h('p', {}, sendCode) : null,
      h('label', { class: 'field' }, h('span', {}, withCode ? 'The 6-digit code from the email' : 'Your password'), secret),
      h('label', { class: 'check' }, clear, ' Also clear the progress saved on this device'),
      error,
    ],
    actions: [
      { label: 'Cancel', testid: 'btn-cancel' },
      {
        label: 'Delete account', testid: 'btn-confirm-delete', danger: true, keepOpen: true,
        onClick: async () => {
          if (busy) return;
          busy = true;
          const r = withCode
            ? await deleteAccount(null, { code: secret.value.trim(), clearDevice: clear.checked })
            : await deleteAccount(secret.value, { clearDevice: clear.checked });
          busy = false;
          if (!r.ok) {
            error.textContent = r.error;
            error.hidden = false;
            secret.focus();
            return;
          }
          modal.close('action');
          toast('Your account was deleted.');
        },
      },
    ],
  });
  secret.addEventListener('keydown', (e) => { if (e.key === 'Enter') modal.el.querySelector('[data-testid="btn-confirm-delete"]')?.click(); });
  requestAnimationFrame(() => secret.focus());
}
