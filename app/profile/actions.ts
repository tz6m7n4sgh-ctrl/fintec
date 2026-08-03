'use server';

import { revalidatePath } from 'next/cache';
import { isBlank, numberError, parseFormNumber } from '@/lib/forms/numbers';
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

/**
 * Reads every numeric field at once, or reports the first one that is not a
 * number.
 *
 * This used to be a per-field helper that returned `0` when `Number()` gave
 * `NaN` — so `32,000`, which is how people write salaries, was saved as zero
 * and the form said it had worked. Gratuity, leave encashment, ILOE and the
 * runway were then computed from a basic salary of nothing, every figure
 * rendering confidently. The `gross >= basic` constraint could not catch it
 * either, because zero satisfies it.
 *
 * Collected here rather than field-by-field so the action can refuse *before*
 * writing anything, rather than writing a partly-invented row.
 */
function readNumbers(
  form: FormData,
  fields: Record<string, string>,
): { ok: true; values: Record<string, number> } | { ok: false; error: string } {
  const values: Record<string, number> = {};

  for (const [key, label] of Object.entries(fields)) {
    const raw = String(form.get(key) ?? '');

    // Blank still means zero. Most of these are genuinely zero for most
    // people, and forcing a 0 into every box would be worse than useless.
    if (isBlank(raw)) {
      values[key] = 0;
      continue;
    }

    const parsed = parseFormNumber(raw);
    if (!parsed.ok) return { ok: false, error: numberError(label, parsed.reason) };
    values[key] = parsed.value;
  }

  return { ok: true, values };
}

/**
 * Every numeric field, with the name the user sees on the label.
 *
 * The label matters: "is not a number" is useless on a form with sixteen
 * boxes. The key is the form field name, so this list also serves as the
 * check that no numeric field is read without validation.
 */
const NUMERIC_FIELDS: Record<string, string> = {
  basicSalary: 'Basic salary',
  grossSalary: 'Gross salary',
  unpaidLeaveDays: 'Unpaid leave days',
  unusedLeaveDays: 'Unused leave days',
  noticePeriodDays: 'Notice period days',
  noticeDaysPaidInLieu: 'Notice days paid in lieu',
  otherOwedToEmployee: 'Other owed to you',
  owedToEmployer: 'Owed to your employer',
  iloeAvgBasic6m: 'Average basic over 6 months',
  cashSavings: 'Cash savings',
  otherLiquidAssets: 'Other liquid assets',
  dependents: 'Dependents',
  visaGraceDays: 'Visa grace days',
  healthCoverMonthsAfterEnd: 'Health cover months after end',
};

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

  const numbers = readNumbers(form, NUMERIC_FIELDS);
  if (!numbers.ok) return { ok: false, error: numbers.error };
  const v = numbers.values;

  // user_id is set explicitly because it is the conflict target for the
  // upsert. RLS still enforces that it matches auth.uid() — a forged value
  // would be rejected by the policy, not merely by this line.
  const row = {
    user_id: user.id,
    basic_salary: v.basicSalary,
    gross_salary: v.grossSalary,
    employment_start: employmentStart,
    expected_last_day: expectedLastDay,
    unpaid_leave_days: v.unpaidLeaveDays,
    unused_leave_days: v.unusedLeaveDays,
    notice_period_days: v.noticePeriodDays,
    notice_days_paid_in_lieu: v.noticeDaysPaidInLieu,
    other_owed_to_employee: v.otherOwedToEmployee,
    owed_to_employer: v.owedToEmployer,
    iloe_subscribed_12m: b(form, 'iloeSubscribed12m'),
    iloe_involuntary: b(form, 'iloeInvoluntary'),
    iloe_avg_basic_6m: v.iloeAvgBasic6m,
    cash_savings: v.cashSavings,
    other_liquid_assets: v.otherLiquidAssets,
    dependents: v.dependents,
    visa_grace_days: v.visaGraceDays,
    health_cover_months_after_end: v.healthCoverMonthsAfterEnd,
  };


  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' });
  if (error) return { ok: false, error: explain(error.message) };

  // Every screen reads the profile, so every screen is now stale.
  revalidatePath('/', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Income streams (US-27 / FR-C2 / §6.3)
//
// The salary ending when the job does is not enforced here. It is a property of
// the stream's own end date, evaluated by `lib/engine/income.ts` — which is what
// "enforced in code rather than seeded" means for this story. What this action
// does is make that date editable and default it sensibly.
// ---------------------------------------------------------------------------

export interface IncomeResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const FREQUENCIES = ['monthly', 'oneOff'] as const;
type Frequency = (typeof FREQUENCIES)[number];

function explainIncome(message: string): string {
  if (message.includes('income_dates_ordered')) {
    return 'The end date is before the start date.';
  }
  if (message.includes('income_streams_name_check') || message.includes('length(trim(name))')) {
    return 'Give the income stream a name.';
  }
  if (message.includes('violates check constraint')) {
    return 'The amount cannot be negative.';
  }
  return message;
}

/** Creates or updates one income stream. */
export async function saveIncomeStream(
  _prev: IncomeResult,
  form: FormData,
): Promise<IncomeResult> {
  const id = String(form.get('id') ?? '').trim() || undefined;
  const fail = (error: string): IncomeResult => ({ ok: false, error, id });

  const supabase = await createClient();
  if (!supabase) return fail('Supabase is not configured for this deployment.');

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail('You are signed out. Sign in again to save.');

  const name = String(form.get('name') ?? '').trim();
  if (!name) return fail('Give the income stream a name.');

  const frequency = String(form.get('frequency') ?? 'monthly') as Frequency;
  if (!FREQUENCIES.includes(frequency)) return fail('Pick monthly or one-off.');

  /*
   * Same rule as the profile: an unreadable amount refuses rather than
   * becoming zero. A "5,000" typed into an income stream used to save a
   * stream worth nothing — which is worse than rejecting it, because the row
   * then appears in the list, looks real, and contributes nothing to the
   * projection it was added to change.
   */
  const parsedAmount = parseFormNumber(String(form.get('amount') ?? ''));
  if (!parsedAmount.ok) return fail(numberError('Amount', parsedAmount.reason));

  const row = {
    user_id: user.id,
    name,
    amount: parsedAmount.value,
    frequency,
    start_date: d(form, 'startDate'),
    end_date: d(form, 'endDate'),
    active: b(form, 'active'),
  };

  const { error } = id
    ? await supabase.from('income_streams').update(row).eq('id', id)
    : await supabase.from('income_streams').insert(row);

  if (error) return fail(explainIncome(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Deletes one income stream. RLS scopes it; no redundant user_id filter. */
export async function deleteIncomeStream(
  _prev: IncomeResult,
  form: FormData,
): Promise<IncomeResult> {
  const id = String(form.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Nothing to delete.' };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: 'Supabase is not configured for this deployment.', id };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'You are signed out. Sign in again to save.', id };

  const { error } = await supabase.from('income_streams').delete().eq('id', id);
  if (error) return { ok: false, error: explainIncome(error.message), id };

  revalidatePath('/', 'layout');
  return { ok: true };
}
