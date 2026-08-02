/**
 * What "erase everything" covers (US-46 / FR-I4).
 *
 * Pure, and in `lib/` rather than beside the action, for the mechanical reason
 * that a `'use server'` module may only export async functions — and for the
 * better one that this list is the definition of the feature. A table added to
 * the schema and forgotten here would leave the user's data behind on the one
 * operation that promises it is gone, and nothing would say so.
 *
 * `erase.test.ts` checks it against the migrations, so the promise and the
 * schema cannot drift.
 */

/** The phrase the user must type. Deliberately not "yes" and not a checkbox. */
export const ERASE_CONFIRMATION = 'ERASE MY DATA';

/**
 * Every table holding user rows, children before parents.
 *
 * Order is not required for correctness — the intra-user foreign keys are all
 * `on delete set null` or `on delete cascade`, so any order completes — but
 * deleting children first avoids a cascade of pointless UPDATEs on rows that
 * are about to be deleted anyway.
 *
 * `profiles` is last deliberately. It is the row that makes the app consider a
 * user configured at all, so if a run dies halfway an app with a profile and no
 * data degrades more honestly than one with data and no profile.
 */
export const ERASABLE_TABLES = [
  'notification_log',
  'transactions',
  'statement_uploads',
  'category_rules',
  'checklist_items',
  'scheduled_payments',
  'school_fees',
  'debts',
  'income_streams',
  'budget_categories',
  'bank_accounts',
  'notification_prefs',
  'profiles',
] as const;

export type ErasableTable = (typeof ERASABLE_TABLES)[number];
