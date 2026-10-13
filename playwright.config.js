import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  globalTimeout: 15 * 60_000,
  // One retry absorbs the occasional hung Chrome launch on this machine; flaky tests are still reported.
  retries: 1,
  fullyParallel: true,
  // More than two parallel Chrome instances (each running two Stockfish workers) hangs this machine.
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // PW_CHANNEL=chrome runs against an installed Google Chrome instead of the bundled Chromium.
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: { timeout: 30_000 },
    // The app installs a service worker that caches ~4 MB; only the offline tests need it.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node server/index.js',
    // Every test browser connects from 127.0.0.1, so lift the per-address abuse limits.
    env: { PORT: String(PORT), DB_PATH: ':memory:', PUSH: 'dry', VAPID_FILE: 'test-results/.vapid-e2e.json', WEEKLY_POOL_FILE: 'tests/fixtures/weekly-puzzles.json', AUTH_BURST: '10000', MAIL: 'dry', TEST_HOOKS: '1', AUTH_ENV_FILE: '/nonexistent/chess-auth.env', PUBLIC_ORIGIN: `http://127.0.0.1:${PORT}`, MAIL_INBOX_BURST: '10000', MAIL_ADDRESS_BURST: '100000', APP_ORIGINS: `capacitor://localhost,https://localhost,http://localhost:${PORT}`, CSP_CONNECT_EXTRA: `http://127.0.0.1:${PORT} ws://127.0.0.1:${PORT}`, SYNC_BURST: '10000', ROOMS_PER_ADDRESS: '10000', ROOM_CREATES_PER_HOUR: '10000', WS_CONNECT_BURST: '10000', WS_CONNECTIONS_PER_ADDRESS: '10000' },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false, // always test the current code, never a stale dev server
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
