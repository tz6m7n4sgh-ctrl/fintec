/**
 * Lighthouse CI configuration.
 *
 * Gives NFR-9 ("dashboard interactive < 2 s on a typical mobile connection") a
 * measurement, which nothing previously had.
 *
 * WHY THIS IS JS RATHER THAN JSON
 *
 * GitHub Pages serves a project site from /<repo>, so CI builds with
 * NEXT_PUBLIC_BASE_PATH=/fintec and every asset in the export is referenced as
 * /fintec/_next/... . The first version of this file hard-coded
 * http://127.0.0.1:3210/ , so Lighthouse loaded the HTML but every stylesheet
 * and script 404'd, and it then dutifully audited an unstyled page:
 * accessibility 0.96 (nav links measured 17px tall with no CSS padding, failing
 * target-size) and best-practices 0.96 (console errors from the failed
 * requests). The scores looked like Chrome-version drift and were not — the
 * page under test was simply broken.
 *
 * So the URLs are derived from the same env var the build and the e2e suite
 * use, and `next start` mounts at the matching sub-path. Wrong base path now
 * means a 404 rather than a plausible-looking score.
 *
 * MEASURED STATE, median of 3 runs, default mobile profile (Slow 4G, 4x CPU):
 * FCP 0.81 s, Speed Index 0.81 s, LCP 1.08 s, TBT 147 ms, CLS 0,
 * TTI 1.98 s (dashboard) / 1.88 s (report). NFR-9's 2000 ms target is MET.
 *
 * It was not met when this file was first written, and the reason is worth
 * keeping: the hand-written static server it used to measure against served
 * everything uncompressed while a real host compresses text. Lighthouse was
 * measuring the test rig, not the app. Fixing that took the CSS from 11,936 to
 * 2,792 bytes and TTI from ~3.4 s to ~1.98 s, with no application code changed.
 * That server is now gone entirely: these numbers come from `next start`, which
 * is what actually runs in production and compresses by default.
 *
 * The margin is thin — 1981 ms against a 2000 ms target is about 1%. So the
 * assertions below are ratchets set with headroom for runner variance rather
 * than pinned to the target itself; asserting 2000 ms would flake. Tighten them
 * as real margin appears, and never loosen them.
 *
 * Still worth attention: TBT rose 50 -> 147 ms once compression let the JS
 * arrive sooner, and max-potential-FID scores poorly. Faster delivery
 * concentrated the main-thread work rather than removing it.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORIGIN = 'http://127.0.0.1:3210';

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run start -- --port 3210',
      startServerReadyPattern: 'Ready',
      startServerReadyTimeout: 60000,
      url: [`${ORIGIN}${BASE_PATH}/`, `${ORIGIN}${BASE_PATH}/report/`],
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        // NFR-9's target is 2000 ms and the median now sits at ~1981 ms. The
        // ratchet is 2500 ms: enough headroom that a slower CI runner does not
        // flake, tight enough that losing the compression win fails the build.
        interactive: ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
        'first-contentful-paint': ['error', { maxNumericValue: 1500, aggregationMethod: 'median' }],
        /*
         * `aggregationMethod: 'median'` on these three is load-bearing, not
         * decoration.
         *
         * lhci defaults a `minScore` assertion to **optimistic** — the best of
         * the three runs wins. Every numeric assertion above already said
         * `median` explicitly; these did not, and so they were graded on their
         * best run. A green CI build printed `performance: 0.75` on `/` while
         * this line said `minScore: 0.9`, and nothing failed.
         *
         * A ratchet that takes the best of three is not a ratchet. It is the
         * defect this project keeps finding — a check that reports green while
         * the thing it checks is failing — living in the file whose own header
         * says "never loosen them".
         */
        'categories:accessibility': ['error', { minScore: 1, aggregationMethod: 'median' }],
        'categories:best-practices': ['error', { minScore: 1, aggregationMethod: 'median' }],
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        'total-blocking-time': ['error', { maxNumericValue: 300, aggregationMethod: 'median' }],
        // The local static server sets no cache headers and no CSP; GitHub Pages
        // handles the first and cannot do the second. Neither is measurable here.
        'uses-long-cache-ttl': 'off',
        'csp-xss': 'off',
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
