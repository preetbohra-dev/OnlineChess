// Copies the exact third-party browser files we ship from node_modules into public/vendor/.
// The output is committed so the app runs from any static host; tests/unit/vendor-sync.test.js
// fails if a copy drifts from the installed package.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');

const SOURCES = [
  { pkg: 'chess.js', dir: 'dist/esm', to: 'chess.js', include: /\.js(\.map)?$/ },
  { pkg: 'chess.js', file: 'LICENSE', to: 'chess.js' },
  { pkg: 'cm-chessboard', dir: 'src', to: 'cm-chessboard/src', include: /\.js$/ },
  { pkg: 'cm-chessboard', dir: 'assets', to: 'cm-chessboard/assets', include: /\.(css|svg)$/ },
  { pkg: 'cm-chessboard', file: 'LICENSE', to: 'cm-chessboard' },
  // Stockfish 19 lite, single-threaded: ~1.8 MB, no SharedArrayBuffer/COOP-COEP needed. GPL-3.0.
  { pkg: 'stockfish', file: 'bin/stockfish-19-lite-single.js', to: 'stockfish', flat: true },
  { pkg: 'stockfish', file: 'bin/stockfish-19-lite-single.wasm', to: 'stockfish', flat: true },
  { pkg: 'stockfish', file: 'Copying.txt', to: 'stockfish' },
];

// Regular files only: symlinks are skipped so a tampered package cannot pull outside files into public/.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Every {src, dest} pair to copy, for packages that are installed.
export function vendorPlan() {
  const plan = [];
  for (const source of SOURCES) {
    const pkgDir = path.join(MODULES, source.pkg);
    if (!fs.existsSync(pkgDir)) {
      console.warn(`vendor: ${source.pkg} is not installed; skipping (run npm install)`);
      continue;
    }
    if (source.file) {
      const name = source.flat ? path.basename(source.file) : source.file;
      plan.push({ src: path.join(pkgDir, source.file), dest: path.join(OUT, source.to, name) });
      continue;
    }
    const base = path.join(pkgDir, source.dir);
    for (const src of walk(base)) {
      if (!source.include.test(src)) continue;
      plan.push({ src, dest: path.join(OUT, source.to, path.relative(base, src)) });
    }
  }
  return plan;
}

function run() {
  const plan = vendorPlan();
  let copied = 0;
  for (const { src, dest } of plan) {
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(src))) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
  }
  console.log(`vendor: ${plan.length} files checked, ${copied} updated in public/vendor`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
