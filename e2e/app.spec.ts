import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests for the shipped screens.
 *
 * These exist to convert manual browser checking into regression protection.
 * Several assertions here encode defects that were found by looking at the
 * rendered pages and would not have been caught by unit tests:
 *
 *   - a stat tile whose caption counted a different set of cheques than its own
 *     figure summed
 *   - the same scenario reading "OK" on one screen and "Tight" on another
 *   - a zero deduction rendering as "-0.00"
 *   - form labels not associated with their inputs
 *
 * Figures asserted below come from the §11 acceptance profile, so a change to
 * the engine that alters what the user sees fails here as well as in the unit
 * tests.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Absolute path within the deployed site, honouring any host sub-path. */
const url = (path: string) => `${BASE_PATH}${path}`;

const ROUTES = [
  { path: '/', name: 'Home' },
  { path: '/calendar/', name: 'Payment calendar' },
  { path: '/schedule/', name: 'Schedule' },
  { path: '/budget/', name: 'Budget' },
  { path: '/loans/', name: 'Loans, mortgage, school fees & cheques' },
  { path: '/profile/', name: 'Income & profile' },
  { path: '/statements/', name: 'Bank statements & transactions' },
  { path: '/report/', name: 'Termination report' },
  { path: '/plan/', name: 'Readiness & action plan' },
  { path: '/settings/', name: 'Settings' },
] as const;

/** Fails the test on any console error or failed request, not just assertions. */
function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  return problems;
}

test.describe('every screen', () => {
  for (const route of ROUTES) {
    test(`${route.path} renders cleanly`, async ({ page }) => {
      const problems = collectPageProblems(page);

      const response = await page.goto(url(route.path));
      expect(response?.status(), `HTTP status for ${route.path}`).toBe(200);

      // Exactly one h1, naming the screen.
      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(route.name);

      // Stylesheet actually applied — catches a broken asset path under a
      // sub-path, which would otherwise render as unstyled but "working" HTML.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg, 'body background should come from the stylesheet').not.toBe('rgba(0, 0, 0, 0)');

      // The legal disclaimer is mandatory on every screen (NFR-7 / BR-12).
      await expect(page.locator('footer.legal')).toContainText('not legal or financial advice');
      await expect(page.locator('footer.legal')).toContainText('600 590 000');

      // No horizontal page scrolling at any viewport (NFR-3).
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${route.path} scrolls horizontally`).toBe(false);

      expect(problems, `console/network problems on ${route.path}`).toEqual([]);
    });
  }
});

test.describe('dashboard', () => {
  test('shows the §11 headline figures', async ({ page }) => {
    await page.goto(url('/'));

    // Runway hero: 9.6 months for the reference profile.
    await expect(page.locator('.hero-num')).toContainText('9.6');

    // Stat tiles, by their label rather than position.
    const tile = (label: string) => page.locator('.tile', { hasText: label }).first();
    await expect(tile('Total resources')).toContainText('220,479');
    await expect(tile('Final settlement')).toContainText('93,479');
    await expect(tile('ILOE total')).toContainText('27,000');
    await expect(tile('Net monthly burn')).toContainText('23,000');
    await expect(tile('Cheques — next 6 months')).toContainText('113,000');
  });

  test('runway status is never colour alone — it carries an icon and a label', async ({ page }) => {
    await page.goto(url('/'));
    const badge = page.locator('.hero .status');
    await expect(badge).toHaveCount(1);
    // A text label a screen reader (or a colourblind reader) can use.
    await expect(badge).toContainText('Good');
    // And a non-colour visual marker.
    expect((await badge.textContent())?.trim().length ?? 0).toBeGreaterThan(4);
  });

  test('the cheque tile caption counts the same cheques its figure sums', async ({ page }) => {
    // Regression: the caption said "8 cheques" while the amount covered only the
    // five inside the six-month window.
    await page.goto(url('/'));
    const tile = page.locator('.tile', { hasText: 'Cheques — next 6 months' }).first();
    await expect(tile).toContainText('113,000');
    await expect(tile).toContainText('5 cheques');
  });

  test('every stat tile navigates to where its inputs live', async ({ page }) => {
    // Traceability is a hard requirement: no AED figure may be a dead end.
    await page.goto(url('/'));
    const tiles = page.locator('.grid.g5 a.tile');
    const count = await tiles.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const href = await tiles.nth(i).getAttribute('href');
      expect(href, `tile ${i} must link somewhere`).toBeTruthy();
      expect(href).not.toBe('#');
    }
  });

  test('projection chart is described for screen readers and marks the zero crossing', async ({ page }) => {
    await page.goto(url('/'));
    const svg = page.locator('svg.plot').first();
    const label = await svg.getAttribute('aria-label');
    expect(label, 'chart needs a text alternative').toBeTruthy();
    expect(label).toContain('220,479');
    // The projection must surface that the balance goes negative, which the
    // flat-burn runway figure alone does not reveal.
    await expect(svg).toContainText('runs out');
  });

  test('every projected month is readable on hover, not just the labelled ones', async ({ page }) => {
    // Only four of nineteen points carry a visible label, so the rest are only
    // reachable via the hover layer. This also guards the hydration failure that
    // adding that layer originally caused: a <title> built from several JSX
    // children emits comment separators React cannot reconcile.
    await page.goto(url('/'));
    const titles = page.locator('svg.plot title');
    expect(await titles.count()).toBeGreaterThanOrEqual(18);
    const texts = await titles.allTextContents();
    expect(texts.some((t) => /Dec 26/.test(t) && /20,000/.test(t))).toBe(true);
    expect(texts.some((t) => /below zero/.test(t))).toBe(true);
  });

  test('scenario cards end in a shortfall at 12 months', async ({ page }) => {
    await page.goto(url('/'));
    const twelve = page.locator('.g4 > .card').filter({ hasText: 'After 12 months' }).first();
    await expect(twelve).toContainText('55,521');
    await expect(twelve).toContainText('Shortfall');
  });
});

test.describe('cross-screen consistency', () => {
  test('a scenario gets the same verdict on the dashboard and the report', async ({ page }) => {
    // Regression: 9 months read "OK" on the dashboard and "Tight" on the report.
    const verdicts = async (path: string) => {
      await page.goto(url(path));
      const out: Record<string, string> = {};
      for (const months of [3, 6, 9, 12]) {
        // Scope to the inner scenario cards: a bare `.card` filter also matches
        // the outer "Scenarios" card, which contains all four badges at once.
        const card = page.locator('.g4 > .card').filter({ hasText: `After ${months} months` }).first();
        const badge = card.locator('.status');
        out[`${months}`] = ((await badge.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      }
      return out;
    };

    const dashboard = await verdicts('/');
    const report = await verdicts('/report/');
    expect(report).toEqual(dashboard);
  });
});

test.describe('termination report', () => {
  test('itemises the settlement without a negative zero', async ({ page }) => {
    await page.goto(url('/report/'));
    await expect(page.locator('body')).toContainText('93,479.47');
    await expect(page.locator('body')).toContainText('87,479.47');
    // Regression: a zero deduction rendered as "-0.00", which reads as a bug.
    const text = (await page.locator('body').textContent()) ?? '';
    expect(text).not.toContain('-0.00');
    expect(text).not.toContain('−0.00');
  });

  test('states both legal deadlines with countdowns', async ({ page }) => {
    await page.goto(url('/report/'));
    await expect(page.locator('body')).toContainText('14 Oct 2026');
    await expect(page.locator('body')).toContainText('30 Oct 2026');
    await expect(page.locator('.count').first()).toContainText('days');
  });

  test('offers a PDF export', async ({ page }) => {
    await page.goto(url('/report/'));
    await expect(page.getByRole('button', { name: /export to pdf/i })).toBeVisible();
  });
});

test.describe('calendar', () => {
  test('pins the three legal deadlines with live countdowns', async ({ page }) => {
    await page.goto(url('/calendar/'));
    const rows = page.locator('.dl-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Final settlement due');
    await expect(rows.nth(1)).toContainText('ILOE claim deadline');
    await expect(rows.nth(2)).toContainText('Visa grace period ends');
    for (let i = 0; i < 3; i++) {
      await expect(rows.nth(i).locator('.count')).toContainText('days');
    }
  });

  test('marks cheques distinctly and explains the marking in a legend', async ({ page }) => {
    await page.goto(url('/calendar/'));
    await expect(page.locator('.ev.cheque').first()).toBeVisible();
    await expect(page.locator('.legend').first()).toContainText('Cheque');
  });
});

test.describe('schedule', () => {
  test('shows the in-budget flag so double counting is auditable', async ({ page }) => {
    await page.goto(url('/schedule/'));
    await expect(page.locator('th', { hasText: 'In budget' })).toBeVisible();
    // The two out-of-budget cheques are the ones the projection deducts as lumps.
    await expect(page.locator('body')).toContainText('65,000');
  });
});

test.describe('transactions ledger', () => {
  /**
   * US-35. The filter controls shipped as disabled placeholders for a long
   * time, so these assert they actually filter rather than merely exist.
   *
   * Counts come from the §11 seed: 12 confirmed rows — six salary credits and
   * six aggregated monthly debits — plus three pending rows that must never
   * appear here, whatever the filters say.
   */
  const ledger = (page: Page) =>
    page.locator('section.card', { hasText: 'Transactions ledger' }).first();

  test('shows every confirmed transaction by default', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    await expect(card.locator('tbody tr')).toHaveCount(12);
    await expect(card).toContainText('Showing 12 of 12');
  });

  test('filters by direction', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    await card.getByLabel('Filter by direction').selectOption('credit');
    await expect(card.locator('tbody tr')).toHaveCount(6);
    await expect(card).toContainText('Showing 6 of 12');
    // Every remaining row really is a credit.
    await expect(card.locator('tbody tr', { hasText: 'Debit' })).toHaveCount(0);
  });

  test('searches descriptions', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    await card.getByLabel('Search transaction descriptions').fill('salary');
    await expect(card.locator('tbody tr')).toHaveCount(6);
    // Case-insensitive: the seed stores these uppercase.
    await expect(card.locator('tbody tr').first()).toContainText('SALARY CREDIT');
  });

  test('filters by date range', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    await card.getByLabel('From date').fill('2026-07-01');
    await card.getByLabel('To date').fill('2026-09-30');
    // Three months of salary plus three months of outgoings.
    await expect(card.locator('tbody tr')).toHaveCount(6);
    await expect(card).not.toContainText('Apr 2026');
  });

  test('an empty result says so, and clearing restores the rows', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    // The ADCB account has only pending rows, so it can never match here.
    await card.getByLabel('Filter by account').selectOption('acc-adcb');
    await expect(card.locator('tbody tr')).toHaveCount(0);
    await expect(card).toContainText('No transactions match these filters');

    await card.getByRole('button', { name: 'Clear filters' }).click();
    await expect(card.locator('tbody tr')).toHaveCount(12);
  });

  test('pending transactions never leak into the ledger', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = ledger(page);
    // DEWA/SALIK are pending; no filter combination should surface them.
    await expect(card).not.toContainText('DEWA');
    await card.getByLabel('Search transaction descriptions').fill('dewa');
    await expect(card.locator('tbody tr')).toHaveCount(0);
  });
});

test.describe('settings', () => {
  /**
   * The Backend card previously rendered "✓ Applied" and "✓ Created" as literals.
   * They happened to be true, but nothing computed them, so they would have gone
   * on claiming success against a fresh project or a half-applied migration.
   *
   * This app's credibility rests on honest status reporting, so the rule is:
   * a row either derives its state or does not assert one.
   */
  test('backend status never asserts what the app cannot check', async ({ page }) => {
    await page.goto(url('/settings/'));
    const backend = page.locator('section.card', { hasText: 'Backend' }).first();

    // Unearned ticks must not come back.
    await expect(backend).not.toContainText('Applied');
    await expect(backend).not.toContainText('Created');
    await expect(backend.getByText('Not checked from here')).toHaveCount(2);

    // The rows it genuinely can derive must still report real state.
    await expect(backend).toContainText('Seed data');
  });
});

test.describe('accessibility', () => {
  for (const route of ROUTES) {
    test(`${route.path} — every control has an accessible name`, async ({ page }) => {
      await page.goto(url(route.path));
      const unnamed = await page.evaluate(() => {
        const problems: string[] = [];
        document.querySelectorAll('input, select, textarea, button, a').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          const id = el.getAttribute('id');
          const labelled = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const wrapping = el.closest('label');
          const name =
            (el.getAttribute('aria-label') ?? '').trim() ||
            (labelled?.textContent ?? '').trim() ||
            (wrapping?.textContent ?? '').trim() ||
            (tag === 'button' || tag === 'a' ? (el.textContent ?? '').trim() : '') ||
            (el.getAttribute('title') ?? '').trim();
          if (!name) problems.push(`<${tag}> class="${el.className}"`);
        });
        return problems;
      });
      expect(unnamed, `unnamed controls on ${route.path}`).toEqual([]);
    });

    test(`${route.path} — data tables have header cells`, async ({ page }) => {
      await page.goto(url(route.path));
      const headerless = await page.evaluate(() =>
        [...document.querySelectorAll('table')]
          .map((t, i) => (t.querySelector('th') ? null : `table #${i}`))
          .filter(Boolean),
      );
      expect(headerless, `tables without headers on ${route.path}`).toEqual([]);
    });
  }
});

test.describe('navigation', () => {
  test('desktop sidebar navigates between screens', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'sidebar is hidden on mobile');
    await page.goto(url('/'));
    await page.locator('.nav a', { hasText: 'Calendar' }).click();
    await expect(page.locator('h1')).toHaveText('Payment calendar');
    await page.locator('.nav a', { hasText: 'Report' }).click();
    await expect(page.locator('h1')).toHaveText('Termination report');
  });

  test('mobile shows bottom tabs instead of the sidebar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'bottom tabs are desktop-hidden');
    await page.goto(url('/'));
    await expect(page.locator('.bottom-tabs')).toBeVisible();
    await expect(page.locator('.side')).toBeHidden();
    await page.locator('.bottom-tabs a', { hasText: 'Calendar' }).click();
    await expect(page.locator('h1')).toHaveText('Payment calendar');
  });

  test('the current screen is marked for assistive technology', async ({ page }) => {
    await page.goto(url('/budget/'));
    await expect(page.locator('[aria-current="page"]').first()).toContainText('Budget');
  });
});

test.describe('theming', () => {
  test('dark mode restyles the page rather than inverting it', async ({ page }) => {
    await page.goto(url('/'));
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    expect(dark).not.toBe(light);
  });

  test('an explicit light theme wins over a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(url('/'));
    const osDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const forcedLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    expect(forcedLight).not.toBe(osDark);
  });
});
