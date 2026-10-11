// WebSocket client for online rooms: JSON messages, automatic reconnect with backoff.
// Reconnects re-send `resume` through the onReconnect hook so the seat is reclaimed.
import { createEmitter } from '../core/events.js';

export function socketUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function createOnlineClient({ url = socketUrl(), maxBackoffMs = 8000 } = {}) {
  const events = createEmitter();
  let ws = null;
  let attempts = 0;
  let closedByUser = false;
  let reconnectTimer = null;
  const pending = [];

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      const reconnect = attempts > 0;
      attempts = 0;
      events.emit('open', { reconnect });
      while (pending.length && ws.readyState === WebSocket.OPEN) ws.send(pending.shift());
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      events.emit('message', msg);
      events.emit(msg.type, msg);
    };
    ws.onclose = (event) => {
      events.emit('close', { code: event.code });
      if (event.code === 4000) events.emit('replaced', {});
      // 4000: this seat was taken over by another tab — don't fight over it.
      if (closedByUser || event.code === 4000) return;
      const delay = Math.min(maxBackoffMs, 500 * 2 ** attempts++);
      reconnectTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  }

  connect();

  return {
    on: events.on,
    send(message) {
      const text = JSON.stringify(message);
      if (ws?.readyState === WebSocket.OPEN) ws.send(text);
      else if (pending.length < 10) pending.push(text);
    },
    close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      ws?.close(1000, 'bye');
      events.clear();
    },
  };
}
