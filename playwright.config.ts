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
 * These flags took it from five crashes to two, and serialising the run did not
 * remove the last two. Both of those were mitigations aimed at contention, and
 * contention turned out not to be the difference. This is:
 *
 *   - **CI** ran `chrome-headless-shell`, and crashed on three consecutive runs.
 *   - **This machine** runs the full `chromium` binary, via the
 *     `executablePath` below, and has never crashed across a dozen full runs.
 *
 * `chrome-headless-shell` is a separate, smaller binary Playwright prefers for
 * headless runs. Forcing the full browser in CI too (`channel: 'chromium'`)
 * makes both environments run the same thing — which is worth having on its own
 * terms, since a suite whose browser differs from the developer's is a suite
 * that can pass in one place and fail in the other for reasons nobody can see.
 *
 * The flags stay: they are cheap, they are standard for Chromium in a
 * container, and they demonstrably reduced the crash rate. Parallelism is
 * restored, because serialising was aimed at a cause the evidence no longer
 * supports and it doubled the run for nothing. If crashes return, that is the
 * next lever to pull again.
 *
 * None of this weakens an assertion: the suite renders and reads the DOM and
 * has no GPU-dependent expectation anywhere.
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
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    /*
     * The full Chromium build rather than `chrome-headless-shell`. See
     * HEADLESS_ARGS above — the shell is what crashed in CI, and this is what
     * runs here. `executablePath` still wins where it is set, so this machine
     * keeps using its preinstalled copy and CI stops using a different binary
     * from the one anybody develops against.
     */
    channel: 'chromium',
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
