import type { ParsedRow, MergePlan } from './dedupe';
import type { LogEntry } from './parse';

/**
 * What a parse run tells the user afterwards (US-28 / US-30 / NFR-6).
 *
 * Pure, and separate from the server action, because these are the sentences a
 * person reads before deciding whether to trust a hundred imported rows — and a
 * sentence that overstates what happened is the same defect as a wrong number.
 */

/**
 * Adds the dedupe outcome to the log.
 *
 * The wording is the point. "Imported 96 transactions" after a re-upload that
 * inserted four is true of neither number, and both readings matter: the four
 * are what changed, the ninety-six are what the file contained. Saying both,
 * separately, is what makes US-30's "re-uploading creates 0 new transactions"
 * something the user can see rather than something the tests know.
 */
export function withMergeLog(log: readonly LogEntry[], plan: MergePlan): LogEntry[] {
  const inserted = plan.toInsert.length;
  const duplicates = plan.duplicates.length;
  const out = [...log];

  if (duplicates > 0) {
    out.push({
      level: 'info',
      message:
        inserted === 0
          ? `All ${duplicates} transaction${duplicates === 1 ? '' : 's'} in this file were already in the ledger, so nothing was added. Re-uploading a statement is safe.`
          : `${duplicates} transaction${duplicates === 1 ? ' was' : 's were'} already in the ledger and ${inserted === 1 ? 'was' : 'were'} not added again.`,
    });
  }

  out.push({
    level: 'info',
    message:
      inserted === 0
        ? 'Nothing new to review.'
        : `${inserted} transaction${inserted === 1 ? '' : 's'} added, waiting for you to confirm ${inserted === 1 ? 'it' : 'them'}.`,
  });

  return out;
}

/**
 * The period a statement covers, from the rows themselves.
 *
 * Read from the transactions rather than from the preamble line that usually
 * says "Statement period 01/08/2026 to 31/08/2026". That line is prose in an
 * unspecified format, and parsing it would be a second, weaker date parser
 * whose disagreements with the first would show up as a period that does not
 * contain its own transactions.
 *
 * The cost is honest and small: a statement whose first week had no activity
 * reports a period starting at the first transaction. That is a narrower claim
 * than the bank's, and a narrower true claim beats a wider guessed one.
 */
export function periodOf(rows: readonly ParsedRow[]): { start: string; end: string } | null {
  if (rows.length === 0) return null;

  let start = rows[0].date;
  let end = rows[0].date;
  for (const row of rows) {
    if (row.date < start) start = row.date;
    if (row.date > end) end = row.date;
  }
  return { start, end };
}

/** What the upload row should say after a run. Mirrors `runOutcome`'s shape. */
export function noticeFor(
  error: string | undefined,
  plan: MergePlan | null,
): string | undefined {
  if (error) return error;
  if (!plan) return undefined;
  if (plan.toInsert.length === 0 && plan.duplicates.length > 0) {
    return 'Every transaction in that file was already in your ledger, so nothing was added.';
  }
  if (plan.toInsert.length === 0) return undefined;
  return `${plan.toInsert.length} transaction${plan.toInsert.length === 1 ? '' : 's'} imported and waiting for review below.`;
}
