// Daily-puzzle reminders (Web Push) for signed-in players: subscribe this browser, choose the hour.
// Works where the browser supports push (on iPhone only once the app is on the home screen).

const HEADERS = { 'Content-Type': 'application/json', 'X-OC-Request': '1' };
export const REMINDER_HOURS = [8, 12, 17, 19, 21];

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

const fromBase64Url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.getRegistration('/') ?? navigator.serviceWorker.ready;
}

// The current subscription of this browser, or null.
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// -> { ok: true } | { ok: false, error }
export async function enableReminders(hour) {
  if (!pushSupported()) return { ok: false, error: 'This browser cannot show reminders. On iPhone, add the app to your home screen first.' };
  if ((await Notification.requestPermission()) !== 'granted') return { ok: false, error: 'Notifications are blocked for this site in your browser settings.' };
  try {
    const keyRes = await fetch('/api/push/key');
    if (!keyRes.ok) return { ok: false, error: 'Reminders are not available on this server.' };
    const { publicKey } = await keyRes.json();
    const reg = await registration();
    if (!reg) return { ok: false, error: 'The app is still installing. Try again in a moment.' };
    const subscription = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch('/api/push/subscribe', { method: 'POST', headers: HEADERS, body: JSON.stringify({ subscription: subscription.toJSON(), tz, hour }) });
    if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error ?? 'Could not turn reminders on.' };
    try { localStorage.setItem('oc.v1.reminderHour', String(hour)); } catch { /* optional */ }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not turn reminders on. Check your connection and try again.' };
  }
}

export async function disableReminders() {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', { method: 'POST', headers: HEADERS, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export function savedHour() {
  try { const h = Number(localStorage.getItem('oc.v1.reminderHour')); return REMINDER_HOURS.includes(h) ? h : 19; } catch { return 19; }
}
