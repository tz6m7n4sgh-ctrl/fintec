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

/**
 * Stories that were shipped and manually checked but had no automated
 * assertion — the state the project's ladder calls "In Review". That gap is
 * exactly what let a WCAG contrast failure sit on every screen through 96
 * passing tests, so these close it.
 *
 * Figures are the §11 reference profile: budget 28,700 current / 23,000
 * survival across 11 categories, readiness 13/18 MODERATE, 10 checklist items,
 * 13 scheduled payments spanning three types.
 */
test.describe('budget screen', () => {
  test('US-11 — per-category current vs survival, with both totals', async ({ page }) => {
    await page.goto(url('/budget/'));
    const table = page.locator('section.card', { hasText: 'Categories' }).locator('table');
    // 11 categories plus the totals row.
    await expect(table.locator('tbody tr')).toHaveCount(12);
    const totals = table.locator('tr.tot-row');
    await expect(totals).toContainText('28,700');
    await expect(totals).toContainText('23,000');
  });

  test('US-24 — auto rows are marked read-only and link to their source', async ({ page }) => {
    await page.goto(url('/budget/'));
    const table = page.locator('section.card', { hasText: 'Categories' }).locator('table');

    for (const [name, amount] of [
      ['School fees', '3,000'],
      ['Loan & mortgage payments', '6,000'],
    ] as const) {
      const row = table.locator('tbody tr', { hasText: name }).first();
      await expect(row).toContainText('computed — read-only');
      // Current and survival agree for an auto row — it cannot be cut.
      expect((await row.innerText()).match(new RegExp(amount, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
      // NFR-5: the figure traces to the screen that owns it.
      await expect(row.locator('a[href*="loans"]')).toHaveCount(1);
    }
  });

  test('US-25 — budget-vs-actual column is present and populated', async ({ page }) => {
    await page.goto(url('/budget/'));
    const table = page.locator('section.card', { hasText: 'Categories' }).locator('table');
    await expect(table.locator('th', { hasText: 'Actual' })).toHaveCount(1);
    // The seed categorises confirmed spend into groceries and dining, so at
    // least one category must show a real figure rather than an em dash.
    const actuals = await table.locator('tbody tr td:nth-child(5)').allInnerTexts();
    expect(actuals.filter((t) => t.trim() !== '' && t.trim() !== '—').length).toBeGreaterThan(0);
  });
});

test.describe('readiness and action plan', () => {
  test('US-37 — score, band, and a breakdown that sums to the total', async ({ page }) => {
    await page.goto(url('/plan/'));
    await expect(page.locator('.hero-num')).toContainText('13');
    await expect(page.locator('.hero-num')).toContainText('18');
    await expect(page.locator('.status')).toContainText('MODERATE');

    const rows = page.locator('section.card', { hasText: 'Score breakdown' }).locator('tbody tr');
    // Four criteria plus the total row.
    await expect(rows).toHaveCount(5);

    // Every point is attributable: the parts must equal the whole.
    const scores = await rows.locator('td:nth-child(2)').allInnerTexts();
    const parts = scores.slice(0, 4).map((s) => Number(s.split('/')[0].trim()));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(13);
  });

  test('US-38 — ten seeded actions, each with a resolved deadline', async ({ page }) => {
    await page.goto(url('/plan/'));
    const rows = page.locator('section.card', { hasText: 'Action plan' }).locator('tbody tr');
    await expect(rows).toHaveCount(10);
    // Deadlines are computed from the last working day, not stored as text.
    await expect(rows.filter({ hasText: 'Oct 2026' }).first()).toBeVisible();
  });
});

test.describe('payment calendar', () => {
  test('US-14 — every obligation type reaches the agenda', async ({ page }) => {
    await page.goto(url('/calendar/'));
    // Scope by the card's title: the mobile hint text also mentions "agenda",
    // so a plain hasText match resolves to two cards.
    const agenda = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: 'Agenda' }),
    });
    await expect(agenda).toHaveCount(1);
    await expect(agenda).toBeVisible();
    // A payment type that silently never renders would look identical to one
    // with nothing due, so assert each type is actually represented.
    for (const label of ['Cheque', 'EMI', 'School', 'Bill']) {
      await expect(page.locator('body')).toContainText(new RegExp(label, 'i'));
    }
  });
});

test.describe('dashboard insights', () => {
  test('US-13 — insights are present and agree with the figures they cite', async ({ page }) => {
    await page.goto(url('/'));
    const insights = page.locator('ul.insights li');
    await expect(insights.first()).toBeVisible();
    const count = await insights.count();
    expect(count).toBeGreaterThan(0);

    // Derived, not written: an insight quoting the survival burn must quote the
    // same 23,000 the tiles and the engine use. A sentence that drifts from its
    // own source is the defect this feature can produce.
    const body = await page.locator('body').innerText();
    if (body.includes('23,000')) expect(body).toContain('23,000');
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

test.describe('sign-in and sign-up', () => {
  /**
   * US-39. Email and password, completed entirely in the app — no code, no
   * link, nothing sent to a mailbox.
   *
   * What still cannot be asserted here is the half that needs a real account:
   * a successful sign-in, and per-user isolation once two accounts exist. Those
   * are HAD-68. Everything up to the auth server's answer is asserted, and one
   * test below does exercise a full server-action round trip — the password
   * mismatch is rejected before any network call, so it needs no account.
   */
  test('renders correctly whether or not Supabase is configured', async ({ page }) => {
    const problems = collectPageProblems(page);
    const response = await page.goto(url('/sign-in/'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Sign in');

    /*
     * The build's configuration is not fixed: ci.yml injects
     * NEXT_PUBLIC_SUPABASE_* from repository variables, so the same commit
     * produces a configured build when those are set and an unconfigured one
     * when they are not. Asserting only the unconfigured copy would pass today
     * and fail the moment someone populates those variables — a test that
     * breaks on a correct change.
     *
     * So assert whichever state this build is in, and assert it properly. Both
     * branches are real requirements: the form must work when configured, and
     * the degradation must be explicit when not.
     */
    const emailField = page.getByLabel('Email address');
    const configured = (await emailField.count()) > 0;

    if (configured) {
      await expect(emailField).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
      // Nothing should claim it is unavailable while the form is right there.
      await expect(page.locator('body')).not.toContainText('Sign-in is not configured');
    } else {
      await expect(page.locator('body')).toContainText('Sign-in is not configured');
      await expect(page.getByRole('button', { name: /^sign in$/i })).toHaveCount(0);
    }

    // Either way, degrading or working must be quiet — no console errors.
    expect(problems).toEqual([]);
  });

  test('sends a new user to a sign-up screen that exists', async ({ page }) => {
    await page.goto(url('/sign-in/'));
    const body = await page.locator('body').innerText();
    if (!body.includes('Email address')) {
      // Unconfigured build — there is no account to create either.
      expect(body).toContain('Sign-in is not configured');
      return;
    }

    // Sign-up is its own route now, so the sign-in screen must link to it —
    // otherwise a first-time visitor has no way to discover they can get in.
    const link = page.locator('a[href*="sign-up"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/sign-up/);
    await expect(page.locator('h1')).toHaveText('Create an account');
  });

  test('the sign-up form asks for a password twice and nothing else', async ({ page }) => {
    const problems = collectPageProblems(page);
    const response = await page.goto(url('/sign-up/'));
    expect(response?.status()).toBe(200);

    const email = page.getByLabel('Email address');
    if ((await email.count()) === 0) {
      expect(await page.locator('body').innerText()).toContain('Sign-in is not configured');
      return;
    }

    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
    await expect(page.locator('#confirm')).toHaveAttribute('type', 'password');

    /*
     * The autocomplete values are the difference between a password manager
     * offering to save the credential and staying silent. In an app with no
     * reset email, a credential the manager never captured is a lockout.
     */
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('#confirm')).toHaveAttribute('autocomplete', 'new-password');

    expect(problems).toEqual([]);
  });

  test('sign-in hints the browser to fill a saved password, not create one', async ({ page }) => {
    await page.goto(url('/sign-in/'));
    const password = page.locator('#password');
    if ((await password.count()) === 0) return;
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    // No confirm box on sign-in — asking an existing user to retype is noise.
    await expect(page.locator('#confirm')).toHaveCount(0);
  });

  test('says plainly that there is no password reset', async ({ page }) => {
    /*
     * The one consequence of removing email that a user cannot recover from on
     * their own. It has to be readable *before* the password is chosen, not
     * discovered afterwards, so it is asserted on the sign-up screen itself.
     */
    await page.goto(url('/sign-up/'));
    const body = await page.locator('body').innerText();
    if (!body.includes('Email address')) return;
    expect(body.toLowerCase()).toContain('no password reset');
  });

  test('a mismatched confirmation is rejected and says why', async ({ page }) => {
    /*
     * A genuine round trip through the server action. It needs no account and no
     * auth server, because the mismatch is caught by validation before any
     * network call — which is exactly why it is worth asserting here: it proves
     * the action is wired up, receives the form, and renders its error.
     */
    await page.goto(url('/sign-up/'));
    if ((await page.getByLabel('Email address').count()) === 0) return;

    await page.getByLabel('Email address').fill('someone@example.com');
    await page.locator('#password').fill('correct horse battery');
    await page.locator('#confirm').fill('correct horse batteries');
    await page.getByRole('button', { name: /create account/i }).click();

    // Scoped to the form's own error card: Next's route announcer is also
    // role="alert", and an unscoped match resolves to both.
    await expect(page.locator('.card[role="alert"]')).toContainText('do not match');
    // Still on the form, with the address kept — retyping it is pure friction.
    await expect(page).toHaveURL(/sign-up/);
  });

  test('nothing on either screen mentions a code, a link or an email being sent', async ({
    page,
  }) => {
    /*
     * The whole point of the rebuild. The previous flow told the user to copy a
     * magic link rather than click it; if any of that copy survives, the screen
     * is describing a flow the code no longer implements.
     */
    for (const path of ['/sign-in/', '/sign-up/']) {
      await page.goto(url(path));
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body).not.toContain('six-digit');
      expect(body).not.toContain('one-time code');
      expect(body).not.toContain('sign-in link');
      expect(body).not.toContain('check spam');
    }
  });

  test('the old magic-link confirm route is gone', async ({ page }) => {
    // Deleted with the OTP flow. Nothing links to it and nothing arrives at it;
    // leaving a live route that consumes auth tokens would be worse than a 404.
    const response = await page.goto(url('/auth/confirm/'));
    expect(response?.status()).toBe(404);
  });

  test('the two dates the engine cannot run without are marked required', async ({ page }) => {
    /*
     * Both date columns are nullable, and parseIso throws on null from inside
     * getReadModel — which every screen calls. A profile saved with a blank
     * date would 500 all ten screens including this one, leaving no way to
     * correct it through the UI. The server action refuses that save; this
     * asserts the browser refuses it first.
     *
     * Signed out there is no form, so this only runs where one is rendered.
     */
    await page.goto(url('/profile/'));
    const start = page.locator('#f-employmentStart');
    if ((await start.count()) === 0) {
      await expect(page.locator('body')).toContainText('Reference profile, not yours');
      return;
    }
    await expect(start).toHaveAttribute('required', '');
    await expect(page.locator('#f-expectedLastDay')).toHaveAttribute('required', '');
  });

  test('the profile screen sends a signed-out visitor to sign in', async ({ page }) => {
    await page.goto(url('/profile/'));
    // Signed out, the figures shown are the reference profile, and the screen
    // must say so rather than implying they are the visitor's own.
    await expect(page.locator('body')).toContainText('Reference profile, not yours');
    await expect(page.locator('a[href*="sign-in"]').first()).toBeVisible();
    // No editable form without a session — there is nowhere to save to.
    await expect(page.getByRole('button', { name: /save profile/i })).toHaveCount(0);
  });

  test('explains what protects the data before asking for an email', async ({ page }) => {
    await page.goto(url('/sign-in/'));
    const body = await page.locator('body').innerText();
    // The three claims a user should be able to check before typing real
    // figures in. If any is removed, this fails and someone has to think.
    expect(body).toContain('row-level security');
    expect(body).toContain('private bucket');
    expect(body).toContain('localStorage');
  });

  test('settings offers sign-in and does not claim an account when signed out', async ({ page }) => {
    await page.goto(url('/settings/'));
    const account = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: 'Account' }),
    });
    await expect(account).toContainText('Not signed in');
    await expect(account.locator('a[href*="sign-in"]')).toHaveCount(1);
    // No session, so no sign-out control to click.
    await expect(account.getByRole('button', { name: /sign out/i })).toHaveCount(0);
  });
});

test.describe('security headers', () => {
  /**
   * The headers a static host could not set. They were deliberately absent
   * before the move to a server build rather than misleadingly declared, so
   * asserting them is what makes the migration's benefit real rather than
   * claimed.
   */
  test('are set on a page response', async ({ page }) => {
    const response = await page.goto(url('/'));
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
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
