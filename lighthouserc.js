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
 * use. scripts/serve-out.mjs reads it too, so the server mounts at the matching
 * sub-path. Wrong base path now means a 404 rather than a plausible-looking
 * score.
 *
 * MEASURED STATE, median of 3 runs, default mobile profile (Slow 4G, 4x CPU):
 * FCP 1.1 s, Speed Index 1.1 s, CLS 0, TBT 50 ms, but LCP 3.4 s and TTI ~3.4 s.
 * NFR-9 is therefore NOT met today.
 *
 * Asserting 2000 ms would paint CI permanently red and teach everyone to ignore
 * it. Instead `interactive` is a ratchet pinned just above the current median,
 * so a real regression fails the build. NFR-9's actual target is 2000 ms:
 * tighten this number as TTI improves, and never loosen it.
 *
 * Caveat before optimising: scripts/serve-out.mjs sends no gzip/brotli while
 * GitHub Pages does, so these figures are pessimistic against the deployed site.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORIGIN = 'http://127.0.0.1:3210';

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node scripts/serve-out.mjs',
      startServerReadyPattern: 'Serving',
      startServerReadyTimeout: 30000,
      url: [`${ORIGIN}${BASE_PATH}/`, `${ORIGIN}${BASE_PATH}/report/`],
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        interactive: ['error', { maxNumericValue: 4000, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['error', { maxNumericValue: 4000, aggregationMethod: 'median' }],
        'first-contentful-paint': ['error', { maxNumericValue: 2000, aggregationMethod: 'median' }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 1 }],
        'categories:performance': ['error', { minScore: 0.85 }],
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
