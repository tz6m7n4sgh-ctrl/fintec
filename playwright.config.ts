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

/**
 * Flags added after HAD-30, and worth recording why rather than leaving as
 * cargo cult.
 *
 * Registering a service worker adds a process per browser context, and the run
 * that introduced it produced five Chromium crashes on the CI runner — none of
 * them assertion failures:
 *
 *   [pid=3986][err] [sandbox_linux.cc:405] InitializeSandbox() called with
 *                   multiple threads in process gpu-process.
 *   [pid=3986][err] Received signal 11 SEGV_MAPERR 0000000001b0
 *
 * The crash is at *launch*, inside GPU-process init, before any navigation —
 * so it is resource pressure on a constrained runner rather than anything the
 * worker does.
 *
 * `--disable-gpu` and `--disable-dev-shm-usage` took it from five crashes to
 * two. Not enough, and the log showed why: a GPU process still spawned and
 * still died there, because `--disable-gpu` falls back to the software
 * rasteriser rather than skipping the process. `--disable-software-rasterizer`
 * is the other half of that pair.
 *
 * `workers: 1` in CI is the blunt half of the fix, and it is here because the
 * cause is contention: two browsers launching at once on a two-core runner.
 * It costs wall-clock (about 1.3m to 3m) and nothing else. This project runs
 * `retries: 0` deliberately — "a financial UI regression is never probably
 * fine" — so the alternative to spending that time is a suite that goes red at
 * random, which would teach us to ignore it.
 *
 * None of this weakens an assertion: the suite renders and reads the DOM and
 * has no GPU-dependent expectation anywhere. It does **not** reproduce on this
 * dev machine (`/dev/shm` is 7.9G here), so it is a mitigation for an observed
 * CI failure rather than a fix verified locally, and both changes went in
 * together — so if it goes green I will know the combination worked, not which
 * half. Said plainly because that is what the evidence supports.
 */
const HEADLESS_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
];

const launchOptions = {
  args: HEADLESS_ARGS,
  ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
};

export default defineConfig({
  testDir: './e2e',
  // A financial UI regression is never "probably fine" — no retries masking flake.
  retries: 0,
  fullyParallel: true,
  // See HEADLESS_ARGS above: browser launches crash under contention on the CI
  // runner. Serialising there trades wall-clock for a suite that means what it
  // says, which is the only trade this project makes on test reliability.
  workers: process.env.CI ? 1 : undefined,
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
