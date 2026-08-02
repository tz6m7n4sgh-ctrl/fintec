# `send-reminders`

The daily funding-reminder job (US-16 / HAD-13). Runs at 20:00 UTC — midnight in
Asia/Dubai — invoked by the `pg_cron` schedule in migration 0013.

## Why the job lives here and not in GitHub Actions

It reads every user's payments, which needs the service-role key. That key
bypasses row-level security, and SEC-3 established that this project holds it
**nowhere** — not in the repository, not in GitHub secrets, not in the
deployment environment. Supabase injects it into an Edge Function at runtime, so
it exists only where it must. Running the same job from GitHub Actions would
have meant putting it in a CI secret store, which is the property this project
has kept all along.

## `_engine/` is generated

Do not edit anything under `_engine/`. It is copied from `lib/engine/` by:

```
node scripts/vendor-engine.mjs
```

The job must compute exactly what the app shows — a reminder sender that
disagrees with the screen listing the same reminders is this project's signature
defect with the stakes turned up. A second hand-written Deno implementation
would drift, and drift silently, because both would keep producing plausible
schedules.

`scripts/vendor-engine.test.ts` runs in the normal `npm test` gate and fails if
the copy is out of date, if the vendored set is not closed under its own
imports, or if a `@/…` alias survives (Deno cannot resolve one).

## Deploying

```
supabase functions deploy send-reminders --project-ref <ref>
```

The repository is the source of truth. The version currently deployed was
uploaded during development and is behaviourally identical to these files, but
was minified of comments in transit — redeploy from here before relying on it.

## Configuration

Nothing sends until these are set. Each is deliberately outside the repository.

| Where | Name | Why |
| --- | --- | --- |
| Edge Function secrets | `RESEND_API_KEY` | The email provider. Absent, the job computes and reports but sends nothing. |
| Edge Function secrets | `REMINDER_FROM` | Sender address. Defaults to an `.invalid` domain so a misconfiguration fails rather than sending from somewhere unexpected. |
| Edge Function secrets | `REMINDER_JOB_SECRET` | Optional. When set, the function requires a matching `x-reminder-secret` header — worth setting, because the anon key that satisfies `verify_jwt` ships in the client bundle by design. |
| Database → Vault | `reminder_job_url` | `https://<ref>.supabase.co/functions/v1/send-reminders` |
| Database → Vault | `reminder_job_token` | The bearer token `pg_cron` calls with. |

Without the two Vault secrets, `public.trigger_reminder_job()` raises rather
than returning quietly — a scheduled job that silently does nothing is worse
than one that fails, because `cron.job_run_details` records the exception where
a no-op looks identical to "no reminders were due".

## What it does not do

**Web push.** It needs a VAPID pair and a service worker (HAD-30), and on iOS an
installed PWA. `push_enabled` is read and reported, never acted on. Email
carries the whole load, which is the design rather than a stopgap — see the
"email cannot be turned off" reasoning in `lib/settings/notifications.ts`.

## Verified against the live database

Deployed, invoked through `pg_net`, and checked against a throwaway account
carrying four payments on 2 Aug 2026:

| Payment | Expected | Result |
| --- | --- | --- |
| Rent cheque, due 9 Aug, quarterly | 7-day lead lands today | counted |
| Balloon cheque, due 4 Aug, `atRisk` | 2-day lead lands today | counted |
| Cheque due 9 Aug, `paid` | silent — cleared is not exposure | silent |
| Auto-debit due 9 Aug | silent — R-5 is about cheques | silent |

`{"day":"2026-08-02","usersConsidered":1,"remindersDue":2,"sent":0,...}` with
`notDelivered` naming the missing key rather than reporting success.

That run also caught a real bug: the column is `account_label`, not `account`,
so every reminder would have read "Fund your account with AED 18,000" instead of
naming the bank the money has to be in — which is the whole point of the
message. Reading the schema would not have found it; running against it did.
