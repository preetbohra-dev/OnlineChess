// Browser transport: Stockfish 19 lite (single-threaded WASM) in a Web Worker.
// The .wasm file must sit next to the .js file; the loader finds it relative to its own URL.
export const STOCKFISH_URL = '/vendor/stockfish/stockfish-19-lite-single.js';

export function createWorkerTransport(url = STOCKFISH_URL) {
  const worker = new Worker(url);
  let listener = () => {};
  let onError = () => {};
  worker.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    for (const line of event.data.split('\n')) if (line) listener(line);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    onError(new Error(event.message || 'worker failed'));
  };
  return {
    post: (command) => worker.postMessage(command),
    onLine: (fn) => { listener = fn; },
    onError: (fn) => { onError = fn; },
    terminate: () => worker.terminate(),
  };
}
