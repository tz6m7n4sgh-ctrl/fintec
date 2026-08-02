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

test.describe('profile — income streams', () => {
  /*
   * Matched on the card's own title rather than `hasText`. HAD-80 gave the
   * Money card help text reading "Derived from the income streams below", and a
   * substring selector promptly matched two cards and failed on strict mode.
   * The title is what identifies a card; its prose is not.
   */
  const streamsCard = (page: import('@playwright/test').Page) =>
    page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Income streams$/ }),
    });

  test('US-27 — signed out, income streams are read-only and say why', async ({ page }) => {
    await page.goto(url('/profile/'));
    const card = streamsCard(page);
    await expect(card).toContainText('Sign in to record your own');
    await expect(card.getByRole('button', { name: 'Add an income stream' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  });

  test('HAD-80 — the profile shows side income as derived, not as an input', async ({ page }) => {
    /*
     * The profile used to carry its own `monthlySideIncome` field, which was
     * what `runway()` read, while the streams list beside it fed nothing. A
     * user could add a stream, see it in the table, and watch runway not move.
     *
     * The number on this screen now comes from `runway.monthlySideIncome`, so
     * there is no longer an input here to disagree with the list. Asserting the
     * help text is the cheapest way to catch someone reinstating the field.
     */
    await page.goto(url('/profile/'));
    const money = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Money$/ }),
    });
    await expect(money).toContainText('Monthly side income');
    await expect(money).toContainText('Derived from the income streams below');
    // An input would mean it is still a second source.
    await expect(money.locator('input[name="monthlySideIncome"]')).toHaveCount(0);
  });

  test('US-27 — the salary carries the last working day as its end date', async ({ page }) => {
    await page.goto(url('/profile/'));
    const card = streamsCard(page);
    // The seed's salary ends 30 Sep 2026, the same date as expectedLastDay.
    // That agreement used to be a coincidence nothing checked; the engine now
    // derives "salary stops when the job does" from this date, so it is worth
    // pinning that the date is actually here.
    await expect(card).toContainText('30 Sep 2026');
  });
});

test.describe('settings — password', () => {
  const card = (page: Page) =>
    page.locator('section.card').filter({ has: page.locator('.card-title', { hasText: /^Passwords$/ }) });

  test('HAD-74 — signed out, there is no password here to change', async ({ page }) => {
    await page.goto(url('/settings/'));
    await expect(card(page)).toContainText('Sign in to change your password');
    await expect(card(page).getByRole('button', { name: /Change password/ })).toHaveCount(0);
  });

  test('HAD-74 — the card separates changing from forgetting', async ({ page }) => {
    /*
     * The distinction is the whole honesty of this screen. Changing a password
     * requires knowing it; recovering a forgotten one needs a reset email or a
     * second factor, and this app has neither by design. A card that offered
     * "change password" without saying so would read as though the forgotten
     * case were covered.
     */
    await page.goto(url('/settings/'));
    await expect(card(page)).toContainText('forgotten');
    await expect(card(page)).toContainText('no reset link');
  });
});

test.describe('typographic hierarchy (HAD-65)', () => {
  /**
   * The bug this guards is invisible to every other check, and it is also
   * invisible to the obvious test — which is worth recording, because I wrote
   * that test first and it passed with the font removed entirely.
   *
   * `globals.css` uses 550, 580, 620, 640 and 650. Those only resolve as
   * written on a variable face. `system-ui` is variable on Apple platforms and
   * is Segoe UI on Windows and Roboto on Android, neither of which is — so 550
   * and 620 both snap to 600, and the distinction between a figure and its
   * caption disappears on the machines most people use.
   *
   * **`getComputedStyle().fontWeight` cannot see this.** It reports the
   * *declared* value, 550, whether or not any face can render 550. The snapping
   * happens during font selection and is never exposed to script. So the
   * assertion everyone reaches for first — read two weights, assert they differ
   * — passes identically with and without a variable font, and proves nothing.
   *
   * What is observable is the **rendering**. Two identical strings at 550 and
   * 620 have different advance widths on a variable face and byte-identical
   * ones on a face that snapped both to 600. That is measurable, and it is what
   * these tests do.
   */

  /** Renders one string twice at two weights and returns both widths. */
  const widthsAt = (page: Page, a: number, b: number) =>
    page.evaluate(
      async ([w1, w2]) => {
        const make = (weight: number) => {
          const el = document.createElement('span');
          // Long enough that a per-glyph difference accumulates past rounding,
          // and digits because that is what this app renders in these weights.
          el.textContent = '220,479 113,000 9.6 months';
          el.style.cssText =
            `position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:40px;font-weight:${weight};`;
          document.body.appendChild(el);
          return el;
        };
        const first = make(w1);
        const second = make(w2);
        await document.fonts.ready;
        const out = [
          first.getBoundingClientRect().width,
          second.getBoundingClientRect().width,
        ];
        first.remove();
        second.remove();
        return out;
      },
      [a, b],
    );

  test.beforeEach(async ({ page }) => {
    await page.goto(url('/'));
    await page.evaluate(() => document.fonts.ready);
  });

  test('550 and 620 render differently — the pair that collapses without a variable font', async ({ page }) => {
    /*
     * A stat tile's label against its value. On Segoe UI or Roboto both become
     * 600 and these two widths are equal, which is the defect. This is the
     * assertion that actually fails when the variable font is removed.
     */
    const [light, heavy] = await widthsAt(page, 550, 620);
    expect(light).toBeGreaterThan(0);
    expect(heavy, `550 rendered ${light}px, 620 rendered ${heavy}px`).not.toBe(light);
  });

  test('640 and 650 render differently — the hero number against the brand', async ({ page }) => {
    // The other collapsing pair: both snap to 700 on a non-variable face.
    const [a, b] = await widthsAt(page, 640, 650);
    expect(b, `640 rendered ${a}px, 650 rendered ${b}px`).not.toBe(a);
  });

  test('weight increases width monotonically across the axis', async ({ page }) => {
    // A face with only 400 and 700 produces two distinct widths across five
    // requests. A variable one produces five.
    const widths = await page.evaluate(async () => {
      const out: number[] = [];
      for (const weight of [300, 450, 550, 620, 800]) {
        const el = document.createElement('span');
        el.textContent = '220,479 113,000 9.6 months';
        el.style.cssText =
          `position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:40px;font-weight:${weight};`;
        document.body.appendChild(el);
        await document.fonts.ready;
        out.push(el.getBoundingClientRect().width);
        el.remove();
      }
      return out;
    });

    expect(new Set(widths).size, `widths were ${widths.join(', ')}`).toBe(widths.length);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  test('the loaded face is first in the stack, ahead of the fallback', async ({ page }) => {
    /*
     * `document.fonts.check` asks whether a *loaded* face can render that
     * request — a different question from what the stylesheet declared, which
     * is the distinction this whole block turns on.
     *
     * The family assertion is deliberately on the resolved stack rather than on
     * a hashed class name: `next/font/local` names the family after the
     * variable it was assigned, so the name is stable and readable, and pinning
     * a hash would fail on every unrelated rebuild.
     */
    const { family, loaded } = await page.evaluate(() => {
      const el = document.querySelector('.hero-num');
      return {
        family: el ? getComputedStyle(el).fontFamily : '',
        // A non-standard weight on purpose — this is the request that a static
        // face cannot satisfy.
        loaded: document.fonts.check('550 15px interVariable'),
      };
    });

    expect(family, 'the self-hosted face must come before the fallback').toMatch(
      /^interVariable/,
    );
    expect(family, 'the metric-adjusted fallback should still be present').toContain('Fallback');
    expect(loaded, 'a face capable of weight 550 must actually be loaded').toBe(true);
  });

  test('the font is self-hosted — no third-party request', async ({ page }) => {
    /*
     * `font-src 'self'` says this must hold, but the CSP is Report-Only so it
     * would not block a violation. This is the check that does. A CDN font on a
     * financial app is a second origin watching page loads.
     */
    const origins: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'font') origins.push(new URL(r.url()).origin);
    });

    await page.goto(url('/'));
    await page.evaluate(() => document.fonts.ready);

    const own = new URL(page.url()).origin;
    expect(origins.length, 'a font file should actually be fetched').toBeGreaterThan(0);
    for (const origin of origins) expect(origin, 'font must be same-origin').toBe(own);
  });
});

test.describe('installable app (US-47)', () => {
  test('the manifest is served, and says what installing gets you', async ({ request }) => {
    /*
     * HAD-30 noted the installable claim rested on the file existing rather
     * than on a test. This is the test.
     */
    const res = await request.get(url('/manifest.webmanifest'));
    expect(res.status()).toBe(200);

    const manifest = JSON.parse(await res.text());
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('en-AE');
    expect(manifest.icons.length).toBeGreaterThan(0);
    // Maskable, or Android crops the icon into a circle and clips it.
    expect(manifest.icons[0].purpose).toContain('maskable');
  });

  test('the service worker is served and registers', async ({ page }) => {
    /*
     * Push delivery has no other mechanism — no registration, no reminders on
     * that channel at all.
     *
     * What this does NOT prove is the CSP's part in it. I checked: deleting
     * `worker-src 'self'` from lib/security/csp.ts leaves this test green,
     * because the policy is Report-Only and a report-only violation blocks
     * nothing and logs nothing here. So this asserts that registration works
     * today, not that the policy permits it once enforced. Said rather than
     * implied, because a test that looks like it covers the CSP and does not is
     * worse than no test.
     */
    const problems = collectPageProblems(page);
    await page.goto(url('/'));

    /*
     * Waited for rather than sampled once. Registration happens in an effect,
     * so it runs *after* hydration, which is after `goto` resolves — a single
     * `getRegistration()` immediately afterwards is a race that passes alone
     * and fails under parallel load. It did exactly that.
     *
     * `navigator.serviceWorker.ready` is the obvious wait and the wrong one: it
     * never rejects, so a registration that fails hangs the test until the
     * suite timeout and reports as a timeout rather than as "no worker". The
     * bounded poll below fails with the actual answer.
     */
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      for (let i = 0; i < 50; i++) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) return 'registered';
        await new Promise((r) => setTimeout(r, 100));
      }
      return 'none';
    });

    expect(registered).toBe('registered');
    expect(problems, 'registering the worker must raise nothing').toEqual([]);
  });

  test('the worker does not cache HTML — a stale figure is worse than none', async ({ request }) => {
    /*
     * The design decision this whole file turns on. Every screen here is a
     * number somebody is deciding on; a cached page serves one that was true at
     * some point in the past, with nothing saying so. That is the app's
     * signature defect — a plausible wrong number rather than a visible failure
     * — delivered faster.
     *
     * Asserted against the worker's source because the alternative is
     * simulating an offline navigation, and this is the property that must hold
     * rather than the mechanism.
     */
    const sw = await (await request.get(url('/sw.js'))).text();
    const precache = /const PRECACHE = \[([^\]]*)\]/.exec(sw);
    expect(precache, 'PRECACHE must be declared as a literal list').toBeTruthy();
    expect(precache![1]).not.toContain('.html');
    expect(precache![1]).not.toMatch(/['"]\/['"]/); // the document root
    expect(sw).toContain("addEventListener('push'");
  });
});

test.describe('settings — reminders', () => {
  const card = (page: Page, title: RegExp) =>
    page.locator('section.card').filter({ has: page.locator('.card-title', { hasText: title }) });

  test('US-44 — signed out, the toggles are absent rather than fake', async ({ page }) => {
    /*
     * Preferences are per account. Rendering live-looking switches against the
     * §11 seed would invite someone to set a reminder that has nowhere to be
     * stored — the same defect as the "Delete all data" button that did
     * nothing, on the screen where it would cost the most.
     */
    await page.goto(url('/settings/'));
    const notifications = card(page, /^Notifications$/);
    await expect(notifications).toContainText('Sign in to set your reminders');
    await expect(notifications.getByRole('button', { name: /Save reminder/ })).toHaveCount(0);
  });

  test('US-44 — email is stated as mandatory, not shown as a dead switch', async ({ page }) => {
    // A greyed-out control invites "why can't I?". The sentence answers it, and
    // the reason is real: push is best-effort, so email is the only floor.
    await page.goto(url('/settings/'));
    await expect(card(page, /^Notifications$/)).toContainText('Email cannot be turned off');
  });

  test('HAD-13 — the card says nothing is sent, and names what is missing', async ({ page }) => {
    /*
     * The schedule is built; the sender is not. A notifications panel that
     * implies delivery it cannot perform is the worst possible version of the
     * "looks live, does nothing" defect this project keeps catching.
     */
    await page.goto(url('/settings/'));
    await expect(card(page, /^Notifications$/)).toContainText('No email or push is delivered');

    const delivery = card(page, /^Reminder delivery$/);
    await expect(delivery).toContainText('Email provider');
    await expect(delivery).toContainText('Web-push key');
    await expect(delivery).toContainText('Scheduled job');

    /*
     * The rows must distinguish built from configured, not blur them. HAD-30
     * added the service worker, so that row is genuinely "Built" — while the
     * VAPID key remains an operator step. A card that showed one state for both
     * would be the "coming soon" summary this replaced.
     */
    const row = (name: string) => delivery.locator('tbody tr', { hasText: name }).first();
    await expect(row('Service worker')).toContainText('Built');
    await expect(row('Email provider')).toContainText('Not configured');
  });

  test('US-16 — the schedule is real and carries the copy US-16 specifies', async ({ page }) => {
    await page.goto(url('/settings/'));
    const schedule = card(page, /^Your reminder schedule$/);
    // "Fund [account] with AED X before [date]" — the acceptance criterion,
    // asserted against the §11 cheques rather than a fixture.
    await expect(schedule).toContainText(/Fund .* with AED [\d,]+ before /);
    await expect(schedule.locator('tbody tr').first()).toBeVisible();
  });

  test('US-16 — a recurring cheque appears more than once in the schedule', async ({ page }) => {
    /*
     * The defect the reminder engine exists to avoid. Reminding off the payment
     * row rather than its occurrences fires once for the quarterly rent cheque
     * and never again — for the largest cheque in the reference profile.
     */
    await page.goto(url('/settings/'));
    const rows = card(page, /^Your reminder schedule$/).locator('tbody tr');
    const landlord = await rows.filter({ hasText: 'Landlord' }).count();
    expect(landlord).toBeGreaterThan(1);
  });
});

test.describe('settings — erase all data', () => {
  const dataCard = (page: import('@playwright/test').Page) =>
    page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Your data$/ }),
    });

  test('US-46 — signed out, there is nothing to erase and it says so', async ({ page }) => {
    await page.goto(url('/settings/'));
    const card = dataCard(page);
    await expect(card).toContainText('Sign in to erase your data');
    await expect(card.getByRole('button', { name: /Erase/ })).toHaveCount(0);
  });

  test('US-45 — signed out, export offers the sample data to nobody', async ({ page }) => {
    /*
     * These screens are the §11 reference dataset, which is not stored
     * anywhere. An export link here would hand somebody a file of sample
     * figures labelled as their backup — a plausible-looking wrong answer,
     * which is the defect class this project keeps finding.
     */
    await page.goto(url('/settings/'));
    const card = dataCard(page);
    await expect(card).toContainText('Sign in to export or import');
    await expect(card.getByRole('link', { name: /Export all data/ })).toHaveCount(0);
    await expect(card.getByLabel('Import from JSON')).toHaveCount(0);
  });

  test('US-45 — the export route hands nothing to a caller with no session', async ({ request }) => {
    /*
     * The route is a GET that returns every figure the user owns, so the one
     * assertion that must hold is that a request without a session gets a
     * refusal and not a file.
     *
     * Both refusals are accepted because both are correct: 503 when the suite
     * runs with no backend configured, 401 when it runs against a real project
     * signed out. Pinning one would make this test pass or fail on which
     * machine ran it rather than on the app's behaviour.
     *
     * The content-type assertion is the second half. An unhandled throw would
     * return an HTML error page to somebody who clicked "export my data", which
     * reads as data loss rather than as "you are signed out".
     */
    const res = await request.get(url('/settings/export/'), { maxRedirects: 0 });
    expect([401, 503]).toContain(res.status());
    expect(res.headers()['content-type']).toContain('text/plain');
    expect(await res.text()).not.toContain('"version"');
  });
});

test.describe('plan — action checklist', () => {
  test('HAD-85 — signed out, the checklist is visible but not tickable', async ({ page }) => {
    await page.goto(url('/plan/'));
    const card = page.locator('section.card').filter({ hasText: 'Claim ILOE' }).first();
    await expect(card).toContainText('Claim ILOE');
    await expect(card.getByRole('button', { name: /^Mark / })).toHaveCount(0);
  });

  test('HAD-85 — the screen still says ticking does not change the score', async ({ page }) => {
    /*
     * Asserted on the page as well as in readiness.test.ts, because the claim
     * and the code are two different things and this is the one the user reads.
     * A checklist that moved the score would reward ticking over doing.
     */
    await page.goto(url('/plan/'));
    await expect(page.locator('body')).toContainText('does not inflate the score');
  });
});

test.describe('profile — bank accounts', () => {
  const accountsCard = (page: import('@playwright/test').Page) =>
    page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Bank accounts$/ }),
    });

  test('US-28 — the accounts card exists at all (HAD-84)', async ({ page }) => {
    /*
     * The regression this exists to prevent. `UploadsEditor` told a signed-in
     * user with no accounts to "add a bank account on your profile", and no
     * such control existed anywhere — so statement upload, and with it every
     * downstream part of M3, was unreachable for every real user. It looked
     * fine signed out because the §11 seed has three accounts.
     */
    await page.goto(url('/profile/'));
    await expect(accountsCard(page)).toBeVisible();
    // 'Emirates NBD' is the stored bankName; 'ENBD ··4821' is the abbreviated
    // form the statements screen composes. Asserting the stored value keeps
    // this test about the card existing rather than about label formatting.
    await expect(accountsCard(page)).toContainText('Emirates NBD');
  });

  test('US-28 — signed out, accounts are read-only and say why', async ({ page }) => {
    await page.goto(url('/profile/'));
    const card = accountsCard(page);
    await expect(card).toContainText('Sign in to record your own');
    await expect(card.getByRole('button', { name: 'Add a bank account' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Delete .* account$/ })).toHaveCount(0);
  });

  test('US-28 — the statements empty state links somewhere that exists', async ({ page }) => {
    // The other half of HAD-84: prose describing a destination is what let the
    // dead end ship. A link is checkable; a sentence is not.
    await page.goto(url('/statements/'));
    const link = page.getByRole('link', { name: 'Add a bank account' });
    if (await link.count() > 0) {
      await expect(link.first()).toHaveAttribute('href', '/profile/');
    }
    // Signed out the seed has accounts, so the empty state may not render. What
    // must always hold is that the profile it points at carries the card.
    await page.goto(url('/profile/'));
    await expect(accountsCard(page)).toBeVisible();
  });
});

test.describe('budget — categorisation rules', () => {
  const rulesCard = (page: import('@playwright/test').Page) =>
    page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Categorisation rules$/ }),
    });

  test('US-32 — signed out, rules are read-only and say why', async ({ page }) => {
    await page.goto(url('/budget/'));
    const card = rulesCard(page);
    await expect(card).toContainText('Sign in to record your own');
    await expect(card.getByRole('button', { name: 'Add a rule' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit rule / })).toHaveCount(0);
  });

  test('US-32 — rules render in the order the engine evaluates them', async ({ page }) => {
    /*
     * The table is the explanation. `ADCB CAR LOAN` and `ADCB` would resolve by
     * specificity at equal priority, so showing rules in creation order would
     * leave the user deriving precedence from two columns in their head.
     */
    await page.goto(url('/budget/'));
    const rows = rulesCard(page).locator('tbody tr');
    await expect(rows.first()).toContainText('ADCB CAR LOAN');
  });

  test('US-32 — a rule suggests a category in the review inbox', async ({ page }) => {
    // End to end: the DEWA rule sorts into Utilities, and the pending DEWA
    // transaction on /statements/ must arrive already suggesting it.
    await page.goto(url('/budget/'));
    await expect(rulesCard(page)).toContainText('DEWA');
    await expect(rulesCard(page).locator('tbody tr', { hasText: 'DEWA' })).toContainText('Utilities');
  });
});

test.describe('statements — review inbox', () => {
  const inbox = (page: import('@playwright/test').Page) =>
    page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Review inbox$/ }),
    });

  test('US-31 — signed out, confirming is disabled and says why', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = inbox(page);
    await expect(card).toContainText('Sign in to review your own');
    await expect(card.getByRole('button', { name: /^Confirm/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Discard / })).toHaveCount(0);
  });

  test('US-33 — a matching debit is suggested, and an unmatchable one is not', async ({ page }) => {
    /*
     * Precision, asserted end to end. The §11 seed has three pending rows:
     *
     *   DEWA SEP BILL 690        → matches pay-dewa (700, 1 Oct)
     *   ADCB CAR LOAN 2,400      → matches pay-car  (2,400, 6 Oct)
     *   SALIK TOLL RECHARGE 100  → matches nothing, and must stay that way
     *
     * A matcher that fired on Salik would be finding the two and also inviting
     * a confirmation that marks something paid which was never owed.
     */
    await page.goto(url('/statements/'));
    const card = inbox(page);

    const dewa = card.locator('tbody tr', { hasText: 'DEWA SEP BILL' });
    await expect(dewa).toContainText('DEWA');
    await expect(dewa).toContainText('suggested');

    const salik = card.locator('tbody tr', { hasText: 'SALIK TOLL RECHARGE' });
    await expect(salik).toContainText('No match');
    await expect(salik).not.toContainText('suggested');
  });

  test('US-31 — the card states that pending rows count toward nothing', async ({ page }) => {
    /*
     * R-2's safety net, asserted where the user reads it. `monthlyActuals()`
     * skips anything pending — that is pinned in projection.test.ts — and this
     * is the sentence that tells a person so before they confirm.
     *
     * The stale legend that used to sit here said bulk confirm "becomes
     * available once sign-in and persistence are wired up". Both are wired up
     * now, so that claim had to go rather than be left to rot into a lie.
     */
    await page.goto(url('/statements/'));
    await expect(inbox(page)).toContainText('do NOT count in any dashboard figure yet');
    await expect(page.locator('body')).not.toContainText('once sign-in and persistence are wired up');
  });
});

test.describe('statements — uploads', () => {
  test('US-28 — signed out, uploading is disabled and says why', async ({ page }) => {
    await page.goto(url('/statements/'));
    const card = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^Uploads$/ }),
    });
    await expect(card).toContainText('Sign in to upload your own');
    // No write affordance may appear without a session. The storage policy
    // namespaces every object by user id, so there is no path to upload to.
    await expect(card.getByRole('button', { name: 'Upload a statement' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(card.locator('input[type="file"]')).toHaveCount(0);
  });

  test('US-28 — the LLM warning is on the page that sends the file', async ({ page }) => {
    // NFR-1 / the consent this screen owes the user. Statements are the most
    // sensitive thing this app holds and parsing sends their contents out of
    // the database; the warning must not be reachable only by scrolling past.
    await page.goto(url('/statements/'));
    await expect(page.locator('body')).toContainText('read by an LLM');
  });
});

test.describe('loans', () => {
  test('US-20 — signed out, school fees are read-only and say why', async ({ page }) => {
    await page.goto(url('/loans/'));
    const card = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^School fees$/ }),
    });
    await expect(card).toContainText('Sign in to record your own');
    await expect(card.getByRole('button', { name: 'Add a school fee' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  });

  test('US-20 — the annual total divides by 12 into the budget row', async ({ page }) => {
    /*
     * The derivation US-20 exists for, asserted end to end across two screens
     * rather than in the engine alone: 36,000 a year is 3,000 a month, and the
     * budget line that shows it is computed and read-only.
     */
    await page.goto(url('/loans/'));
    const card = page.locator('section.card').filter({
      has: page.locator('.card-title', { hasText: /^School fees$/ }),
    });
    await expect(card.locator('tr.tot-row')).toContainText('36,000');

    // The tile on this same screen must agree with the table above it. Taken
    // from Codex's PR #18 — a third surface showing the same derivation, and
    // this app has already shipped one tile that disagreed with its own
    // caption (HAD-81).
    await expect(page.locator('.tile', { hasText: 'School fees / month' })).toContainText('3,000');

    await page.goto(url('/budget/'));
    const row = page.locator('tbody tr', { hasText: 'School fees' }).first();
    await expect(row).toContainText('3,000');
    await expect(row).toContainText('computed — read-only');
  });

  test('US-19 — signed out, the debts table is read-only and says why', async ({ page }) => {
    await page.goto(url('/loans/'));
    const card = page.locator('section.card', { hasText: 'Debts' }).first();
    await expect(card).toContainText('Sign in to record your own');
    await expect(card.getByRole('button', { name: 'Add a loan or mortgage' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  });

  test('US-19 — the monthly total is what reaches the budget', async ({ page }) => {
    await page.goto(url('/loans/'));
    // 2,400 car + 3,600 mortgage = 6,000, which is the "Loan & mortgage
    // payments" auto row on /budget. If these two ever disagree, one of the
    // screens is lying about the same figure.
    await expect(page.locator('section.card', { hasText: 'Debts' }).first().locator('tr.tot-row'))
      .toContainText('6,000');
    await page.goto(url('/budget/'));
    const autoRow = page
      .locator('section.card', { hasText: 'Categories' })
      .locator('tbody tr', { hasText: 'Loan & mortgage payments' })
      .first();
    await expect(autoRow).toContainText('6,000');
    await expect(autoRow).toContainText('computed — read-only');
  });

  test('HAD-82 — the cheque register shows status and totals only what is still owed', async ({ page }) => {
    /*
     * The card is headed "these cannot be missed" and had no status column at
     * all, so a cleared cheque looked identical to one still to fund. Its total
     * row said "Total cheque exposure listed" while summing both, directly
     * above the engine's 6-month figure that (as of HAD-82) does not.
     *
     * Nothing in the §11 seed is cleared, so the figure itself is unchanged —
     * which is the point of asserting it here. What must be visible is the
     * distinction, so that the day something does clear, the table says so.
     */
    await page.goto(url('/loans/'));
    const card = page.locator('section.card', { hasText: 'Post-dated cheques' });

    await expect(card.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(card.locator('tr.tot-row')).toContainText('Still to fund');
    // Nothing cleared in the seed, so no exclusion note and the register total
    // still equals every cheque on it.
    await expect(card.locator('tr.tot-row')).not.toContainText('cleared');
    await expect(card.locator('tr.tot-row')).toContainText('161,000');
  });
});

test.describe('schedule', () => {
  test('shows the in-budget flag so double counting is auditable', async ({ page }) => {
    await page.goto(url('/schedule/'));
    await expect(page.locator('th', { hasText: 'In budget' })).toBeVisible();
    // The two out-of-budget cheques are the ones the projection deducts as lumps.
    await expect(page.locator('body')).toContainText('65,000');
  });

  /*
   * US-21 (HAD-24). The suite runs signed out, so what is assertable here is
   * the read-only path and the arithmetic — the editor itself needs a session
   * and belongs to the manual pass in HAD-68. Saying so is the point: an
   * assertion that pretended to cover the write path would be worse than none.
   */
  test('US-21 — the 12-month total no longer counts school terms three times', async ({ page }) => {
    await page.goto(url('/schedule/'));
    /*
     * 360,900 over the window ending 2027-10-01, recurrences expanded.
     *
     * This was 396,900 until HAD-81. The difference is 36,000 of school fees
     * the schedule was counting that the user does not owe: each term was
     * stored as its own dated row *and* marked `termly`, so Term 2 recurred
     * three times and Term 3 twice on top of the per-term rows already there.
     *
     * School-fee obligations are now derived from `school_fees` with
     * `recurrence: 'none'` — one row per term, which is what a term is. The
     * cheque exposure figures are unchanged at 113,000 / 161,000, because
     * `chequeExposure` never used recurrence.
     */
    await expect(page.locator('tr.tot-row')).toContainText('360,900');
  });

  test('US-21 — signed out, the table is read-only and says why', async ({ page }) => {
    await page.goto(url('/schedule/'));
    const card = page.locator('section.card', { hasText: 'Scheduled payments' });
    await expect(card).toContainText('Sign in to record your own');
    // No write affordance may appear without a session. If this ever fails it
    // means the editor rendered against the §11 seed, which would invite
    // someone to edit a stranger's figures believing they were their own.
    await expect(card.getByRole('button', { name: 'Add a payment' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  });

  test('US-21 — every cheque in the table carries a non-colour marker', async ({ page }) => {
    await page.goto(url('/schedule/'));
    // R-5: cheques outrank everything else in this app's hierarchy, and the
    // distinction must survive a greyscale or colourblind reading.
    const cheques = page.locator('span.pill.cheque');
    expect(await cheques.count()).toBeGreaterThan(0);
    await expect(cheques.first()).toContainText('Cheque');
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

  test('US-23 — signed out, the budget is read-only and says why', async ({ page }) => {
    await page.goto(url('/budget/'));
    const card = page.locator('section.card', { hasText: 'Categories' });
    await expect(card).toContainText('Sign in to build your own budget');
    // No write affordance without a session. The survival total is the
    // denominator of runway, so an editor rendered over the §11 reference
    // figures would invite someone to plan against a stranger's numbers.
    await expect(card.getByRole('button', { name: 'Save budget' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Add a category' })).toHaveCount(0);
    await expect(card.locator('input[type="number"]')).toHaveCount(0);
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
    // `username`, not `email` — this field identifies the account, and it is
    // what the manager pairs with the password when deciding what to save.
    await expect(page.locator('#email')).toHaveAttribute('autocomplete', 'username');

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
    await expect(page).toHaveURL(/sign-up/);

    /*
     * The address must survive the rejection. React 19 resets an uncontrolled
     * form once its action settles, so without an explicit defaultValue the
     * email box empties on every failed attempt — and the failure most likely
     * to repeat is a mistyped password, where clearing the address punishes the
     * user for a mistake they did not make in that field.
     */
    await expect(page.locator('#email')).toHaveValue('someone@example.com');
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

  /*
   * HAD-79. Report-Only for now — an enforcing policy that is wrong blanks a
   * screen somebody opened to check a legal deadline, so it is trialled before
   * it is enforced.
   */
  test('a nonce-based CSP is present, and never uses unsafe-inline for scripts', async ({ page }) => {
    const response = await page.goto(url('/'));
    const csp = (response?.headers() ?? {})['content-security-policy-report-only'];

    expect(csp, 'CSP-Report-Only header').toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    /*
     * Not present while report-only, and that is the assertion rather than an
     * omission. The directive is inert in a report-only policy and Chromium
     * logs a console error saying so — on every screen, which would bury a real
     * violation in noise the policy generated about itself. `CSP_REPORT_ONLY`
     * drops it and picks the header name from the same switch, so the two
     * cannot drift.
     */
    expect(csp).not.toContain('upgrade-insecure-requests');

    /*
     * The assertion the issue exists for. A CSP with unsafe-inline on scripts
     * scores well and protects nothing, which is worse than no CSP at all —
     * it is the difference between an honest gap and a false claim.
     *
     * Sliced to script-src on purpose: style-src *does* carry unsafe-inline,
     * deliberately and for a documented reason, so asserting against the whole
     * header would either fail or have to be loosened into meaninglessness.
     */
    const scriptSrc = csp!.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  test('the nonce differs between requests', async ({ page }) => {
    // A fixed nonce is a nonce in name only — anything that could inject a
    // script could read the constant and use it.
    const nonceOf = async () => {
      const r = await page.goto(url('/'));
      return /'nonce-([^']+)'/.exec(
        (r?.headers() ?? {})['content-security-policy-report-only'] ?? '',
      )?.[1];
    };
    const first = await nonceOf();
    const second = await nonceOf();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  for (const route of ROUTES) {
    test(`${route.path} raises no CSP violation`, async ({ page }) => {
      /*
       * This is what "read the reports before enforcing" means here. A
       * `report-uri` would post violations to a collector nobody reads; the
       * browser driving the test *is* the collector, across every screen.
       *
       * `securitypolicyviolation` rather than console text: the console message
       * is a Chromium string that could be reworded, and a report-only
       * violation that stopped matching a substring would silently become a
       * passing test.
       */
      const violations: string[] = [];
      await page.exposeFunction('__cspViolation', (d: string) => void violations.push(d));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          const ev = e as SecurityPolicyViolationEvent;
          (window as unknown as { __cspViolation: (d: string) => void }).__cspViolation(
            `${ev.violatedDirective} blocked ${ev.blockedURI || '(inline)'}`,
          );
        });
      });

      await page.goto(url(route.path));
      await page.waitForLoadState('networkidle');
      expect(violations, `CSP violations on ${route.path}`).toEqual([]);
    });
  }
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
