// Runs the same Stockfish 19 lite-single build the browser uses (tests/unit/vendor-sync checks the
// vendored copy is byte-identical) inside Node, exposing the transport interface UciEngine expects:
//   { post(command), onLine(callback), terminate() }
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function createNodeTransport() {
  const enginePath = require.resolve('stockfish/bin/stockfish-19-lite-single.js');
  const wasmPath = enginePath.replace(/\.js$/, '.wasm');
  // A fresh module per engine: the Emscripten factory can only be instantiated once per load.
  delete require.cache[enginePath];
  const init = require(enginePath);
  let listener = () => {};
  const engine = {
    locateFile: (file) => (file.includes('.wasm') ? wasmPath : enginePath),
    listener: (line) => listener(String(line)),
  };
  await init()(engine);
  while (engine._isReady && !engine._isReady()) await new Promise((r) => setTimeout(r, 10));
  let closed = false;
  return {
    post(command) {
      if (closed) return;
      setImmediate(() => {
        if (!closed) engine.ccall('command', null, ['string'], [command], { async: /^go\b/.test(command) });
      });
    },
    onLine(callback) {
      listener = callback;
    },
    terminate() {
      closed = true;
      try { engine.ccall('command', null, ['string'], ['quit']); } catch { /* already gone */ }
    },
  };
}
