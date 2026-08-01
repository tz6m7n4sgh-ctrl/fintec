import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The tests run against a production `next start` server — the same thing that
 * runs in production — including under a sub-path when NEXT_PUBLIC_BASE_PATH is
 * set, so CI exercises the real artefact rather than a dev server.
 *
 * `.next/` must exist: run `npm run build` first (CI does).
 */

const PORT = 3210;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * This environment ships Chromium at a fixed path with browser downloads
 * disabled. Point Playwright at it when present; elsewhere (CI, a dev machine)
 * fall through to the browser `playwright install` provides.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
  : undefined;

export default defineConfig({
  testDir: './e2e',
  // A financial UI regression is never "probably fine" — no retries masking flake.
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions,
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    // The real Next server, not a stand-in. The app used to be a static export
    // served by a hand-written script, and that script was the source of two
    // defects that produced plausible-but-wrong measurements: a base-path
    // mismatch that made Lighthouse audit an unstyled page, and missing
    // compression that made every performance number pessimistic. Testing the
    // actual production server removes that whole class of error.
    command: 'npm run start -- --port ' + PORT,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
