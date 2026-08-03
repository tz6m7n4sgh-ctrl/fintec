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
  /*
   * First, because a passkey is the thing most worth being gone. "Erase my
   * data" that leaves a working credential behind is the one omission a user
   * would care about after the fact, and it is not data in the same sense as
   * the rest of this list — it is a way in.
   */
  'passkeys',
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

/**
 * What a backup carries — everything erasable except credentials.
 *
 * These two lists were the same thing until passkeys existed, and the split is
 * the point rather than an exception. "Delete everything about me" and "give me
 * a copy of my figures" are different questions, and a passkey answers the
 * first and not the second:
 *
 *   - **It cannot be restored.** `credential_id` is unique across the whole
 *     table, and the credential's user handle names the account it was created
 *     for. Importing one into a different account produces a row that collides
 *     or, if it does not, a passkey that `verifyAssertion` refuses. Either way
 *     the import fails or the restored key does not work.
 *   - **It should not be in the file.** A backup is a plain JSON document a
 *     user emails to themselves. Its contents should be their money, not a list
 *     naming every device that can sign in to their account.
 *
 * Derived from `ERASABLE_TABLES` rather than written out, so a new table is
 * still a single decision: add it there, and exclude it here only with a reason.
 */
export const BACKUP_TABLES = ERASABLE_TABLES.filter(
  (table) => table !== 'passkeys',
) as ErasableTable[];
