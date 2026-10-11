// Share cards: a picture of the final position with the result, shared through the system share
// sheet where available, or downloaded (with the link copied) otherwise.
import { createGame } from '../core/rules.js';
import { currentBoardTheme } from './cosmetics.js';
import { toast } from './toast.js';

const W = 1200;
const H = 630;
// Solid glyphs for both colours (filled white or black), with U+FE0E so no platform draws an emoji.
const GLYPH = Object.fromEntries(Object.entries({ k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }).map(([k, g]) => [k, `${g}\uFE0E`]));
const debug = (globalThis.__oc ??= {});

// Draw the card; resolves to a PNG Blob. lines: up to three short strings under the title.
export function drawShareCard({ fen, orientation = 'w', title, lines = [] }, doc = document) {
  const canvas = doc.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const theme = currentBoardTheme();

  ctx.fillStyle = '#16181d';
  ctx.fillRect(0, 0, W, H);

  // The board.
  const size = 530;
  const sq = size / 8;
  const ox = 50;
  const oy = (H - size) / 2;
  const board = createGame({ fen }).board(); // rank 8 first
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const row = orientation === 'w' ? r : 7 - r;
      const col = orientation === 'w' ? f : 7 - f;
      ctx.fillStyle = (r + f) % 2 === 0 ? theme.light : theme.dark;
      ctx.fillRect(ox + col * sq, oy + row * sq, sq, sq);
      const piece = board[r][f];
      if (!piece) continue;
      ctx.font = `${Math.round(sq * 0.82)}px "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = ox + col * sq + sq / 2;
      const y = oy + row * sq + sq / 2 + sq * 0.04;
      ctx.lineWidth = sq * 0.05;
      ctx.strokeStyle = piece.color === 'w' ? '#1b1b1b' : '#f2f2f2';
      ctx.fillStyle = piece.color === 'w' ? '#fafafa' : '#1b1b1b';
      ctx.strokeText(GLYPH[piece.type], x, y);
      ctx.fillText(GLYPH[piece.type], x, y);
    }
  }

  // The text.
  const tx = ox + size + 50;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#7cc4a4';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.fillText('♞ OnlineChess', tx, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px system-ui, sans-serif';
  wrap(ctx, title, tx, 190, W - tx - 40, 54);
  ctx.fillStyle = '#c9ccd3';
  lines.slice(0, 3).forEach((line, i) => fitText(ctx, line, tx, 330 + i * 46, W - tx - 40, 30));
  ctx.fillStyle = '#8b8f98';
  ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(globalThis.location?.host ?? '', tx, H - 60);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

// One line of text, shrunk to fit (down to 20px), then cut with an ellipsis if still too long.
function fitText(ctx, text, x, y, width, size) {
  let px = size;
  ctx.font = `400 ${px}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > width && px > 20) { px -= 2; ctx.font = `400 ${px}px system-ui, sans-serif`; }
  let out = text;
  while (ctx.measureText(out).width > width && out.length > 1) out = `${out.slice(0, -2)}…`;
  ctx.fillText(out, x, y);
}

function wrap(ctx, text, x, y, width, lineHeight) {
  let line = '';
  let row = 0;
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y + row * lineHeight);
      line = word;
      row++;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + row * lineHeight);
}

// Sharing must start inside the tap that asked for it (iOS refuses a share sheet after an await),
// so the card is drawn ahead of time: prepareShare() when the result is shown, sharePrepared()
// straight from the click. Resolves to 'shared' | 'downloaded' | 'cancelled'.
export function prepareShare({ card, text, url, filename = 'onlinechess.png' }) {
  const prepared = { text, url, filename, blob: null, file: null };
  prepared.ready = drawShareCard(card)
    .then((blob) => {
      prepared.blob = blob;
      prepared.file = blob ? new File([blob], filename, { type: 'image/png' }) : null;
      return prepared;
    })
    .catch(() => prepared);
  return prepared;
}

export function sharePrepared(prepared) {
  const { text, url } = prepared;
  debug.lastShare = { text, url };
  if (navigator.share && !debug.forceDownload) {
    const withFile = prepared.file && navigator.canShare?.({ files: [prepared.file] });
    // No await before this call: it must run within the user's tap.
    return navigator.share(withFile ? { files: [prepared.file], text, url } : { text, url })
      .then(() => 'shared', (err) => (err?.name === 'AbortError' ? 'cancelled' : download(prepared)));
  }
  return prepared.ready.then(() => download(prepared));
}

async function download(prepared) {
  const { blob, text, url, filename } = prepared;
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast(blob ? 'Image saved, and the challenge link was copied — paste it to a friend.' : 'Challenge link copied — paste it to a friend.');
  } catch {
    toast(`Share this link: ${url}`, { timeout: 8000 });
  }
  return 'downloaded';
}
