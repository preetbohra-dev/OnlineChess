// Calls to the server's /api/, on the same origin; the session lives in an HttpOnly cookie.

// fetch() for an API path. Throws only when offline, like fetch.
export function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = { 'X-OC-Request': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
}
