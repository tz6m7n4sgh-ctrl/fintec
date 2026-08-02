'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Saves the profile — the row every termination figure is computed from.
 *
 * Upsert on `user_id`, because `profiles_one_per_user` makes a second row
 * impossible by design. First save creates, later saves update, and the form
 * does not need to know which it is doing.
 *
 * Validation is intentionally thin here. The database already encodes the real
 * rules — `profiles_gross_gte_basic`, `profiles_employment_before_exit`, and
 * non-negative checks on every amount — and those constraints are the source of
 * truth. Re-implementing them in TypeScript would create a second, drifting
 * copy. What this does instead is translate a constraint violation into a
 * sentence a person can act on, because "new row violates check constraint
 * profiles_gross_gte_basic" is not that sentence.
 */

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** Form values arrive as strings; money and counts must become numbers. */
function n(form: FormData, key: string): number {
  const raw = String(form.get(key) ?? '').trim();
  if (raw === '') return 0;
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0;
}

function b(form: FormData, key: string): boolean {
  return form.get(key) === 'on' || form.get(key) === 'true';
}

/** A date input gives '' when empty; the column is nullable. */
function d(form: FormData, key: string): string | null {
  const raw = String(form.get(key) ?? '').trim();
  return raw === '' ? null : raw;
}

/** Turns a Postgres constraint name into something worth reading. */
function explain(message: string): string {
  if (message.includes('profiles_gross_gte_basic')) {
    return 'Gross salary cannot be less than basic — gross includes allowances, so it is always the larger figure.';
  }
  if (message.includes('profiles_employment_before_exit')) {
    return 'Your expected last day is before your employment start date.';
  }
  if (message.includes('violates check constraint')) {
    return 'One of the amounts is negative. Every figure here should be zero or above.';
  }
  return message;
}

export async function saveProfile(_prev: SaveResult, form: FormData): Promise<SaveResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: 'Supabase is not configured for this deployment.' };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'You are signed out. Sign in again to save.' };

  /*
   * The one validation that does not belong to the database.
   *
   * Both date columns are nullable, and there is a reason to leave them that
   * way — a half-filled draft is a legitimate row. But the engine counts every
   * deadline, the service period and the entire gratuity from these two dates,
   * and `parseIso` throws on null. That throw happens inside `getReadModel`,
   * which every screen calls, so saving a profile with a blank date would
   * return an error on all ten screens — including this one, the only place the
   * date could be corrected. The app would be unrecoverable through its own UI.
   *
   * A NOT NULL constraint would be the tidier home for this, but it would also
   * forbid the draft row the schema deliberately allows. So the rule lives at
   * the point where the two dates stop being optional: the moment something
   * tries to compute from them.
   */
  const employmentStart = d(form, 'employmentStart');
  const expectedLastDay = d(form, 'expectedLastDay');
  if (!employmentStart || !expectedLastDay) {
    return {
      ok: false,
      error:
        'Employment start and expected last day are both required — every deadline, your service period and your gratuity are counted from them.',
    };
  }

  // user_id is set explicitly because it is the conflict target for the
  // upsert. RLS still enforces that it matches auth.uid() — a forged value
  // would be rejected by the policy, not merely by this line.
  const row = {
    user_id: user.id,
    basic_salary: n(form, 'basicSalary'),
    gross_salary: n(form, 'grossSalary'),
    employment_start: employmentStart,
    expected_last_day: expectedLastDay,
    unpaid_leave_days: n(form, 'unpaidLeaveDays'),
    unused_leave_days: n(form, 'unusedLeaveDays'),
    notice_period_days: n(form, 'noticePeriodDays'),
    notice_days_paid_in_lieu: n(form, 'noticeDaysPaidInLieu'),
    other_owed_to_employee: n(form, 'otherOwedToEmployee'),
    owed_to_employer: n(form, 'owedToEmployer'),
    iloe_subscribed_12m: b(form, 'iloeSubscribed12m'),
    iloe_involuntary: b(form, 'iloeInvoluntary'),
    iloe_avg_basic_6m: n(form, 'iloeAvgBasic6m'),
    cash_savings: n(form, 'cashSavings'),
    other_liquid_assets: n(form, 'otherLiquidAssets'),
    monthly_side_income: n(form, 'monthlySideIncome'),
    dependents: n(form, 'dependents'),
    visa_grace_days: n(form, 'visaGraceDays'),
    health_cover_months_after_end: n(form, 'healthCoverMonthsAfterEnd'),
  };

  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' });
  if (error) return { ok: false, error: explain(error.message) };

  // Every screen reads the profile, so every screen is now stale.
  revalidatePath('/', 'layout');
  return { ok: true };
}
