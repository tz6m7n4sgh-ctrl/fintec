# Screens

Ten routes. Every one is server-rendered, reads the same `ReadModel`, and renders the §11 reference dataset when signed out.

> **Phase 2 replaces this information architecture.** Ten sections are engine-shaped, not user-shaped — they mirror how the calculation is organised rather than what a person came to find out. The plan collapses them to roughly four, around a single date-driven answer. This documents what exists today; [`../phase-2-discovery.md`](../phase-2-discovery.md) documents what replaces it.

## The routes

| Route | Shows |
| --- | --- |
| `/` | Dashboard — readiness band and score, runway, the projection chart, actual spending trend, upcoming payments |
| `/calendar/` | Payment occurrences by month |
| `/schedule/` | Scheduled payments — create, edit, mark paid |
| `/budget/` | Categories with current, survival, difference and actual per month; categorisation rules |
| `/loans/` | Debts, mortgage, school fees and cheques |
| `/statements/` | Upload, the review inbox, and the transaction ledger |
| `/report/` | The full termination calculation, line by line |
| `/plan/` | The action checklist with computed deadlines |
| `/profile/` | Employment, ILOE, money, situation; income streams; bank accounts |
| `/settings/` | Account, backend status, passwords, passkeys, notifications, export/import, erase |

Plus `/sign-in`, `/sign-up`, and `/settings/export` (a route handler returning a JSON download).

## The one rule that shapes every screen

**Signed out, every screen shows the §11 reference dataset and says so.**

Not an empty state, and not a crash. Real numbers in shape, belonging to nobody, with a *Seed data* pill and a sentence explaining what they are. Every write control is disabled with a reason rather than hidden.

The reasoning: a financial app that shows nothing until you sign up cannot be evaluated, and one that shows a stranger's figures without saying so is lying. The seed is how the app is legible before you trust it with anything.

> Phase 2 identifies this as a usability problem rather than a virtue — *"the first screen is somebody else's finances and ten navigation items"* — but the mechanism is sound and should survive. What changes is that a first run comes first.

## Dashboard

The readiness band, the score with its criteria, the runway in months, a projection chart to the zero-crossing, the actual spending trend, and what is due next.

The projection chart is a **server-rendered SVG** with an `aria-label` stating its endpoints in figures — so a screen reader user gets the same information as a sighted one, and the e2e asserts the label rather than the path geometry.

## Report

The settlement, line by line: service period, gratuity broken into its two accrual bands, leave encashment, notice in lieu, deductions, and the total. Plus the deadlines and a disclaimer.

**This is where Phase 2's centre of gravity moves to.** The user's question is not *"show me the calculation"* — it is *"how much am I owed, and can I argue it"*. The line-by-line working stays; what changes is that it becomes the primary interface rather than a separate screen, and it is not exported as a document. The user carries the argument from their phone.

## Statements

Three parts, in flow order: **upload**, the **review inbox**, and the **ledger**.

A CSV is parsed on the server the moment it uploads, deterministically, and never sent anywhere. Rows land `pending` and count towards nothing until confirmed (invariant I-4). Every skipped row appears in a per-file processing log naming its source line and the reason.

PDF and XLSX upload and store, and say plainly that they are not read yet.

## Plan

The §8 action checklist with deadlines resolved from the engine at render time rather than stored — so a corrected deadline reaches everybody. The ILOE row is marked as a **hard** deadline, because it is the one that cannot be recovered from.

Only the `done` flag is per-user, keyed by `seed_key`.

## Settings

Account and sign-out (global — it revokes refresh tokens, not just this browser's cookie). Backend status. Password change, which re-authenticates first. Passkeys. Notification preferences. JSON export and import. Erase everything, behind a typed phrase.

Two rows say **"Not checked from here"** and name the migration that defines them, rather than showing a tick nobody measured. That is invariant I-15 made visible: the screen would have to query the database on every render to earn that tick, to answer a question that changes once a year.

## Accessibility

Not a checklist item — a gate. axe runs across all ten screens, two viewports, both themes, on every pull request, and **zero violations is the passing condition.**

Concrete consequences visible in the code: every form field is programmatically associated with its label (all 21 were once unlabelled); charts carry figures in their accessible names; the idle warning is an `alertdialog` with `aria-live`; tables are scrollable regions with `tabIndex={0}` so keyboard users can reach them; and colour never carries meaning alone.

## Performance

Lighthouse gates on the **median** of three runs. The dashboard sits around 0.98 with total-blocking-time near 0.99.

One finding worth carrying forward: the sidebar renders ten `next/link`s, all in the viewport, and every route in this app is dynamic — so default prefetching triggered ten full server renders during page load, inside the window total-blocking-time measures. On the CI runner that was the difference between 0.99 and 0.77 on the same commit. All navigation links set `prefetch={false}`.
