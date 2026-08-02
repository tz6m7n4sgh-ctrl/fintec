'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Bank accounts (US-28 support / FR-F1 / §4.7).
 *
 * `bank_accounts` was loaded by the repository and written by nothing. That
 * made statement upload unreachable for every real user: `UploadsEditor` told
 * them to add an account on their profile, and no such control existed (HAD-84).
 * Everything in M3 sits downstream of a statement existing, so one missing form
 * held all of it.
 *
 * ## An account is not savings
 *
 * `current_balance` is what the account holds today. `profiles.cash_savings` is
 * what runway divides into — and they are **not** the same fact, so nothing
 * here touches the profile.
 *
 * Someone with 80,000 across three accounts and 80,000 in `cashSavings` has
 * entered one number twice, and if adding an account silently updated the
 * profile, runway would double. That is HAD-80 exactly, and the trap is more
 * inviting here because the two figures look like they should agree.
 *
 * Accounts exist to attribute a transaction to a source. The editor says so.
 */

export interface AccountResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

function s(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

async function client() {
  const supabase = await createClient();
  if (!supabase) return { ok: false as const, error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false as const, error: SIGNED_OUT };
  return { ok: true as const, supabase, user: auth.user };
}

function explain(message: string): string {
  if (message.includes('bank_name') || message.includes('length(trim(bank_name))')) {
    return 'Name the bank — it is how you will recognise the account when attributing a statement.';
  }
  if (message.includes('last4')) {
    return 'The last four digits must be exactly four digits, or left blank.';
  }
  if (message.includes('current_balance')) {
    return 'The balance must be a number.';
  }
  return message;
}

/**
 * Creates or updates one account.
 *
 * `last4` is nullable and constrained to `^[0-9]{4}$`, so an empty field must
 * become null rather than `''` — the constraint rejects the empty string, and
 * the resulting message would be about a regular expression.
 */
export async function saveAccount(_prev: AccountResult, form: FormData): Promise<AccountResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): AccountResult => ({ ok: false, error, id });

  const c = await client();
  if (!c.ok) return fail(c.error);

  const bankName = s(form, 'bankName');
  if (!bankName) return fail('Name the bank.');

  const last4 = s(form, 'last4');
  if (last4 !== '' && !/^[0-9]{4}$/.test(last4)) {
    return fail('The last four digits must be exactly four digits, or left blank.');
  }

  /*
   * Parsed rather than coerced. A balance of 0 is meaningful — an emptied
   * account — and `Number('')` is also 0, so coercing would make "I did not
   * fill this in" indistinguishable from "this account is empty". Blank stays
   * null, which the column allows.
   */
  const rawBalance = s(form, 'currentBalance');
  let currentBalance: number | null = null;
  if (rawBalance !== '') {
    const parsed = Number(rawBalance);
    if (!Number.isFinite(parsed)) return fail('The balance must be a number.');
    currentBalance = parsed;
  }

  const row = {
    user_id: c.user.id,
    bank_name: bankName,
    account_label: s(form, 'accountLabel'),
    last4: last4 === '' ? null : last4,
    currency: s(form, 'currency') || 'AED',
    current_balance: currentBalance,
    is_cheque_account: form.get('isChequeAccount') === 'on',
  };

  const { error } = id
    ? await c.supabase.from('bank_accounts').update(row).eq('id', id)
    : await c.supabase.from('bank_accounts').insert(row);

  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Deletes one account.
 *
 * `bank_account_id` is `on delete set null` on both `transactions` and
 * `statement_uploads`, so removing an account orphans its history rather than
 * destroying it — the transactions survive, unattributed. That is the right
 * direction: a user tidying up a closed account should not lose the spending
 * that ran through it, and the ledger would be wrong if they did.
 */
export async function deleteAccount(_prev: AccountResult, form: FormData): Promise<AccountResult> {
  const id = s(form, 'id');
  const fail = (error: string): AccountResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to delete.');

  const c = await client();
  if (!c.ok) return fail(c.error);

  const { error } = await c.supabase.from('bank_accounts').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}
