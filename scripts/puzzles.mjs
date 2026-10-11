#!/usr/bin/env node
// Builds public/data/puzzles.json: a curated, rating-balanced subset of the Lichess puzzle
// database (CC0, https://database.lichess.org/#puzzles).
//
//   node scripts/puzzles.mjs [source] [--per-band 210] [--out public/data/puzzles.json] [--slot 0]
//
// --slot picks a different, disjoint sample of the database (the hash filter keeps ids whose hash
// leaves remainder <slot>). The weekly challenge uses its own server-only pool from slot 1:
//   node scripts/puzzles.mjs --slot 1 --per-band 50 --out server/data/weekly-puzzles.json
//
// source: a URL or a local path to lichess_db_puzzle.csv.zst (or an uncompressed .csv);
// defaults to the Lichess download. The CSV is streamed and never stored.
//
// Selection: well-tested puzzles only (rating deviation < 90, popularity >= 85, >= 500 plays),
// spread over 100-point rating bands from 400 to 2800 with up to --per-band puzzles each. A
// deterministic hash of the puzzle id thins the stream so the picks are spread through the file;
// the stream stops as soon as every band is full.
//
// Output rows: [id, fen, moves, rating, themes]. As in the Lichess CSV, `fen` is the position
// before the opponent's move and `moves` starts with that move; the solver plays the rest.
import { createReadStream, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';
import { spawnSync, spawn } from 'node:child_process';

const DEFAULT_SOURCE = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const BAND = 100;
const MIN = 400;
const MAX = 2800;

export function parseArgs(argv) {
  const opts = { source: DEFAULT_SOURCE, perBand: 210, out: 'public/data/puzzles.json', sample: 8, slot: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--per-band') opts.perBand = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--sample') opts.sample = Number(argv[++i]);
    else if (a === '--slot') opts.slot = Number(argv[++i]);
    else opts.source = a;
  }
  return opts;
}

// FNV-1a: a stable, cheap hash for thinning the stream.
const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };

// Keep a row? Returns [id, fen, moves, rating, themes] or null.
export function pick(cols, sample = 8, slot = 0) {
  const [id, fen, moves, rating, rd, popularity, plays, themes] = cols;
  const r = Number(rating);
  if (!id || !fen || !moves || !Number.isFinite(r)) return null;
  if (r < MIN || r >= MAX || Number(rd) >= 90 || Number(popularity) < 85 || Number(plays) < 500) return null;
  if (hash(id) % sample !== slot) return null;
  return [id, fen, moves, r, themes];
}

export async function curate(lines, { perBand = 210, sample = 8, slot = 0 } = {}) {
  const bands = new Map();
  const want = (MAX - MIN) / BAND;
  let full = 0;
  for await (const line of lines) {
    if (line.startsWith('PuzzleId')) continue;
    const row = pick(line.split(','), sample, slot);
    if (!row) continue;
    const band = Math.floor((row[3] - MIN) / BAND);
    const list = bands.get(band) ?? [];
    if (list.length >= perBand) continue;
    list.push(row);
    bands.set(band, list);
    if (list.length === perBand && ++full === want) break;
  }
  return [...bands.keys()].sort((a, b) => a - b).flatMap((b) => bands.get(b));
}

// The Lichess file is a seekable zstd archive (many frames, starting with a skippable frame);
// Node's built-in decoder stops at the first frame, so prefer the zstd command-line tool.
function decompress(raw) {
  if (spawnSync('zstd', ['--version']).status === 0) {
    const child = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
    raw.pipe(child.stdin);
    child.stdin.on('error', () => {}); // closed early once every band is full
    return { stream: child.stdout, stop: () => child.kill() };
  }
  const stream = raw.pipe(createZstdDecompress());
  return { stream, stop: () => stream.destroy() };
}

async function open(source) {
  let raw;
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    raw = Readable.fromWeb(res.body);
  } else raw = createReadStream(source);
  const { stream, stop } = source.endsWith('.zst') ? decompress(raw) : { stream: raw, stop: () => {} };
  return { lines: createInterface({ input: stream, crlfDelay: Infinity }), stop: () => { stop(); raw.destroy(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  const { lines, stop } = await open(opts.source);
  let rows;
  try {
    rows = await curate(lines, opts);
  } finally {
    stop();
  }
  // A failed download or decoder leaves too few rows: never overwrite a good file with that.
  const expected = ((MAX - MIN) / BAND) * opts.perBand;
  if (rows.length < expected * 0.8) {
    console.error(`Only ${rows.length} of ~${expected} puzzles found; ${opts.out} left unchanged.`);
    process.exit(1);
  }
  mkdirSync(dirname(opts.out), { recursive: true });
  const tmp = `${opts.out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ source: 'Lichess puzzle database (CC0)', count: rows.length, puzzles: rows })}\n`);
  renameSync(tmp, opts.out);
  console.log(`Wrote ${rows.length} puzzles to ${opts.out}`);
}
