import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated accessibility audit.
 *
 * `app.spec.ts` asserts specific, hand-written accessibility properties —
 * every control has an accessible name, every table has a header cell. Those
 * are deliberate and stay where they are. This file is the general sweep that
 * catches what a hand-written assertion cannot enumerate in advance.
 *
 * It was added after a token audit found `--ink-3` failing the 4.5:1
 * normal-text contrast ratio on all three light-mode surfaces (3.21–3.50:1)
 * while the entire e2e suite stayed green. Contrast is exactly the kind of
 * regression that needs a rule engine rather than a bespoke assertion.
 *
 * Both themes are swept, because the palettes are independent: dark values are
 * stepped for the dark surface rather than derived from the light ones, so a
 * light-mode pass says nothing about dark mode.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const url = (path: string) => `${BASE_PATH}${path}`;

const ROUTES = [
  '/',
  '/calendar/',
  '/schedule/',
  '/budget/',
  '/loans/',
  '/profile/',
  '/statements/',
  '/report/',
  '/plan/',
  '/settings/',
  '/sign-in/',
  '/sign-up/',
  // The first run (B1). It is the first screen a stranger ever sees, so it is
  // the last one that should go unaudited.
  '/start/',
] as const;

const THEMES = [
  { name: 'light', scheme: 'light' as const },
  { name: 'dark', scheme: 'dark' as const },
];

/**
 * WCAG 2.0/2.1/2.2 levels A and AA — the conformance target in NFR-3/NFR-4.
 *
 * 2.2 is included because it is not academic here: `target-size` (SC 2.5.8)
 * caught navigation links below the 24x24px minimum. Omitting the wcag22aa tag
 * meant Lighthouse was checking a rule this suite was not.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Axe reports one violation object per rule, with every offending node inside
 * it. Flattening to "rule — impact — selector" makes a failure say which
 * element on which screen broke, rather than dumping a nested object.
 */
function summarise(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.flatMap((v) =>
    v.nodes.map((n) => `[${v.impact ?? 'unknown'}] ${v.id}: ${n.target.join(' ')} — ${v.help}`),
  );
}

test.describe('axe accessibility audit', () => {
  for (const path of ROUTES) {
    for (const theme of THEMES) {
      test(`${path} — no WCAG A/AA violations in ${theme.name} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme.scheme });
        await page.goto(url(path));

        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

        expect(summarise(violations), `axe violations on ${path} (${theme.name})`).toEqual([]);
      });
    }
  }
});

/**
 * The six fields, which the loop above cannot reach.
 *
 * `/start/figures/` redirects to the doorway question when no doorway has been
 * chosen — deep-linking past it would mean guessing an answer on the user's
 * behalf. So the cookie has to be set before the page exists to audit, and
 * adding it to ROUTES would silently audit the doorway twice instead.
 */
test.describe('axe accessibility audit — the six fields', () => {
  for (const theme of THEMES) {
    test(`/start/figures/ — no WCAG A/AA violations in ${theme.name} mode`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'fintec-doorway', value: 'coming', url: baseURL! }]);
      await page.emulateMedia({ colorScheme: theme.scheme });
      await page.goto(url('/start/figures/'));

      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(
        summarise(violations),
        `axe violations on /start/figures/ (${theme.name})`,
      ).toEqual([]);
    });
  }
});
