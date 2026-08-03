# Invariants

**The things that must stay true.** Each one exists because breaking it produced, or would produce, a failure that *looks like success* — which is the only failure mode this application genuinely fears.

If you are reimplementing this system, read this document before any other. Everything else describes what the app does. This describes what it must never do.

Each invariant names the failure it prevents, because a rule without its reason gets removed by the next person who finds it inconvenient.

---

## I-1 · Never show a plausible wrong number

**Prefer a visible failure to a confident wrong answer.**

This is the root invariant; most of the others are special cases of it. The application computes a termination settlement, a survival runway and a set of legal deadlines. A user acts on those figures — signs a settlement, writes a cheque, books a flight. A figure that is wrong but *plausible* is acted on. A figure that is missing is investigated.

**Concrete instances found in this codebase, all of which rendered normally:**

| Defect | What the user would have seen |
| --- | --- |
| `Number('32,000')` → `NaN` → saved as `0` | A complete settlement computed from a basic salary of nothing |
| A statement date column read as `mm/dd` instead of `dd/mm` | Every transaction moved by months; totals still correct |
| A bank writing withdrawals as positive | Income and spending inverted; the projection running backwards |
| A reminder index without a date | A quarterly rent cheque reminded once, ever |
| Two `isSupabaseConfigured()` functions | Settings reporting "Not configured" while sign-in worked |

**Consequences for an implementation:**

- Refuse ambiguous input rather than picking the more likely reading.
- Never substitute a default for a value that failed to parse.
- Where a claim cannot be checked, say so on screen rather than showing a tick it has not earned.

---

## I-2 · Row-level security is the boundary, and the only boundary

RLS is **enabled and forced** on every table in `public`. Forced matters: without it the table owner bypasses its own policies.

**Application code must not add a redundant `.eq('user_id', …)` filter to a query that RLS already scopes.**

This looks like defence in depth and is the opposite. A redundant filter makes a *broken policy* produce correct results, so the test suite passes, the app behaves, and the isolation guarantee is silently gone. The filter must be absent so that a broken policy fails loudly and immediately.

**The one exception, and it is a real one:** inside an Edge Function running under the service-role key, RLS does not apply at all. There, an explicit `.eq('user_id', …)` **is** the boundary and is mandatory. The rule is not "never filter"; it is "the filter and the policy must never both be the boundary for the same query".

**Where a filter is doing something other than isolation, it stays** — for example `.eq('review_status', 'pending')` in the confirm action, which is a concurrency guard, not a tenancy one.

---

## I-3 · This project holds no service-role key

Not in the repository, not in CI, not in the deployment environment. Supabase injects it into an Edge Function at runtime; that is the only place it exists.

**This is what makes I-2's guarantee unconditional.** If no code path anywhere can bypass a policy, then isolation does not depend on any particular query being written correctly. The moment one service-role client exists in the application, the guarantee becomes "isolation holds provided every service-role query was written carefully" — a much weaker claim, and one no test can establish.

Two features were deliberately *not* built to preserve this: an unattended statement-parsing sweep, and a scheduled reminder job in CI. Both were reachable another way — parse on upload under the user's own JWT, and run the reminder job inside an Edge Function.

---

## I-4 · Nothing a machine produced counts until a person confirms it

Parsed transactions land as `review_status = 'pending'` and are excluded from every figure until confirmed. Budget actuals, spending trends and category totals all count confirmed, non-duplicate rows only.

Prevents an import error from moving a number the user then relies on without ever having seen the row.

---

## I-5 · A passkey is never the sole factor

Email-and-password sign-in always remains available, so losing every registered device is not losing the account.

Enforced by two things rather than documented by one: the password path is never removed, and every WebAuthn ceremony sets `userVerification: 'required'`, so the authenticator itself must have checked a biometric or a PIN. An assertion returning `userVerified: false` is rejected, not downgraded.

---

## I-6 · Email is the guaranteed reminder channel; push is best-effort

The email switch is absent from the preferences form, ignored on read and forced on write. It is not a default the user can turn off.

A bounced cheque in the UAE carries civil and potential criminal consequences. The reminder that prevents it must not depend on a service worker, an installed PWA, or a notification permission the user dismissed months ago.

---

## I-7 · A reminder is logged only after it is sent

Send first, then write the log row. A crash between the two re-sends a reminder, which is mildly annoying. The reverse order writes a log row for a reminder that never went out — and the send-once index then refuses the real one tomorrow, leaving the user **silently un-remindable** about that cheque, permanently.

Between "annoying" and "invisible and irreversible", always choose annoying.

---

## I-8 · Derive; do not duplicate

One source per fact. Where the same fact is stored twice, the two copies diverge and both look right.

**Instances this codebase has already had to fix:** two `isSupabaseConfigured()` functions; income kept both on the profile and as income streams; a school fee paid by cheque existing in two tables; a schema comment describing a dedupe key that omitted a field the code included.

**Practical consequences:**

- A payment's paid state is *derived* from a confirmed matching transaction, not written to it — so un-matching reverts it, losing nothing.
- The action-plan checklist stores only the per-user `done` flag; the item text and computed deadline stay in the seed, so a corrected deadline reaches everybody.
- `supabase/functions/*/\_shared` and `_engine` are **generated** copies of `lib/`, with a drift test that fails the build if they are stale.

---

## I-9 · A stored row always implies its object

Uploads write the storage object first and the database row last. Deletes remove the row first and the object second.

A row whose object is missing is an upload the screen lists, offers to download, and cannot produce — a lie on screen. An object with no row is invisible, costs a few kilobytes, and tells nobody anything false.

---

## I-10 · Erase covers every table a user can reach; backup does not carry credentials

"Erase everything" must clear every table the user has a delete policy on — including `passkeys`, because an erase that leaves a working credential behind is not true.

A backup deliberately excludes credentials. `credential_id` is globally unique and the user handle names the original account, so a restored passkey either collides or fails verification — and a backup is a JSON file people email themselves. It should hold their money, not a list of every device that can sign in.

The test derives the erasable set from the migrations and fails when a new table appears, so this cannot rot by omission.

---

## I-11 · Blank means zero. Unreadable must never mean zero.

Leaving a numeric field empty is a legitimate act and stores `0`. A value that could not be parsed must refuse and say so.

The two were conflated once and it produced the worst defect in the project's history — see I-1.

---

## I-12 · Refuse an ambiguous date column rather than guessing

`03/08/2026` is 3 August in the UAE and 8 March in the United States. A statement covering only the first twelve days of a month contains no evidence either way.

The date order is inferred from the **whole column** — a value above 12 in either position settles it — and a column that stays ambiguous is refused with a message. Picking the local convention is a coin-flip that shifts every row by months when it loses, and nothing about the result looks wrong.

---

## I-13 · Time is Asia/Dubai, and the UAE has no daylight saving

Every date the user acts on — a due date, a deadline, "today" — is computed in Dubai local time, never the server's. The reminder job runs at 20:00 UTC because that is midnight in Dubai, and it recomputes its own day rather than trusting the scheduler's.

---

## I-14 · Money is computed in the engine, formatted in the view

Figures are AED, fixed to two decimal places at the boundary. No component computes a total, and no engine function returns a formatted string. A number that is rounded twice, or summed after rounding, is off by an amount too small to notice and large enough to be wrong.

---

## I-15 · Every claim on screen must be earned

Where the application cannot verify something, it says what it is and where it is defined rather than showing a tick.

The Settings screen does not query the database to confirm the migrations ran — that would be a round trip on every render to answer a question that changes once a year. So those rows say "Not checked from here" and name the migration, instead of asserting a green tick nobody measured.

The same principle applies to CI: a check that skips must fail, not pass. A green tick that means "skipped" is worse than no check, because it reads as coverage.
