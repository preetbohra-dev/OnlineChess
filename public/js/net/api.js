// Calls to the server's /api/. On the website they go to the same origin and the session lives in
// an HttpOnly cookie. Inside the apps they go to the public site, and the session token (returned
// in the body at sign-in) is kept in the app's own storage and sent as a bearer token.
import { isNativeApp, SITE } from './platform.js';
import { appStore } from '../store/storage.js';

const TOKEN_KEY = 'app.session';
export const appToken = (store = appStore()) => store.get(TOKEN_KEY, null);
export function setAppToken(token, store = appStore()) {
  if (token) store.set(TOKEN_KEY, token);
  else store.remove(TOKEN_KEY);
}

// fetch() for an API path. Throws only when offline, like fetch.
export function apiFetch(path, { method = 'GET', body, store = appStore() } = {}) {
  const headers = { 'X-OC-Request': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const native = isNativeApp();
  if (native) {
    headers['X-OC-Client'] = 'app';
    const token = appToken(store);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return fetch(native ? SITE + path : path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: native ? 'omit' : 'same-origin',
  });
}
