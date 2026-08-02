import { describe, expect, it } from 'vitest';
import {
  dedupeHash,
  dedupeKey,
  normaliseDescription,
  planMerge,
  prepare,
  runOutcome,
  type ParsedRow,
} from './dedupe';

/**
 * US-29 / US-30 / BR-6.
 *
 * The rule these tests are really defending is the asymmetry in `dedupe.ts`:
 * over-normalising loses a real transaction silently, under-normalising shows
 * one twice in a review inbox built for exactly that. So several assertions
 * below pin things as **different** that a tidier implementation would have
 * merged, and that is the point rather than an oversight.
 */

const row = (over: Partial<ParsedRow> = {}): ParsedRow => ({
  bankAccountId: 'acc-enbd',
  date: '2026-09-14',
  description: 'ADNOC STATION 41  AUTH 88213',
  amount: 250,
  direction: 'debit',
  ...over,
});

describe('normaliseDescription', () => {
  it('collapses whitespace and case, which are certainly formatting', () => {
    expect(normaliseDescription('  Adnoc   Station  41 ')).toBe('ADNOC STATION 41');
  });

  it('keeps reference numbers — they are often the only difference', () => {
    // Two fuel purchases, same station, same amount, same day. Strip the auth
    // code and the second one never reaches the ledger.
    expect(normaliseDescription('ADNOC AUTH 1')).not.toBe(normaliseDescription('ADNOC AUTH 2'));
  });

  it('keeps punctuation', () => {
    // "CARREFOUR - MOE" and "CARREFOUR MOE" could be two different stores.
    expect(normaliseDescription('CARREFOUR - MOE')).not.toBe(normaliseDescription('CARREFOUR MOE'));
  });
});

describe('dedupeKey', () => {
  it('is stable across formatting of the same transaction', async () => {
    const a = row({ description: 'adnoc station 41  auth 88213', amount: 250 });
    const b = row({ description: '  ADNOC   STATION 41 AUTH 88213 ', amount: 250.0 });
    expect(await dedupeHash(a)).toBe(await dedupeHash(b));
  });

  it('treats 100 and 100.00 as the same money', () => {
    expect(dedupeKey(row({ amount: 100 }))).toBe(dedupeKey(row({ amount: 100.0 })));
  });

  it('separates a charge from its same-day reversal', () => {
    /*
     * The reason `direction` is in the key, and the reason the schema comment
     * in 0001_init.sql was wrong to omit it. A failed charge reversed the same
     * day shares account, date, amount and description with the original. Hash
     * them together and the refund is marked a duplicate and never appears —
     * the user's balance recovers and their ledger does not say why.
     */
    const charge = row({ direction: 'debit' });
    const refund = row({ direction: 'credit' });
    expect(dedupeKey(charge)).not.toBe(dedupeKey(refund));
  });

  it('separates the same transaction on two accounts', () => {
    expect(dedupeKey(row())).not.toBe(dedupeKey(row({ bankAccountId: 'acc-adcb' })));
  });

  it('separates two dates', () => {
    expect(dedupeKey(row())).not.toBe(dedupeKey(row({ date: '2026-09-15' })));
  });

  it('separates two amounts', () => {
    expect(dedupeKey(row())).not.toBe(dedupeKey(row({ amount: 250.01 })));
  });
});

describe('dedupeHash', () => {
  it('is a 64-character hex digest', async () => {
    expect(await dedupeHash(row())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls', async () => {
    expect(await dedupeHash(row())).toBe(await dedupeHash(row()));
  });
});

describe('planMerge', () => {
  it('inserts everything when nothing is stored', async () => {
    const batch = await prepare([row(), row({ amount: 90 })]);
    const plan = planMerge([], batch);
    expect(plan.toInsert).toHaveLength(2);
    expect(plan.duplicates).toHaveLength(0);
  });

  it('re-uploading the same statement inserts nothing — US-30', async () => {
    const batch = await prepare([row(), row({ amount: 90 }), row({ date: '2026-09-20' })]);
    const first = planMerge([], batch);
    expect(first.toInsert).toHaveLength(3);

    // The second run sees the hashes the first one wrote.
    const second = planMerge(first.toInsert.map((r) => r.dedupeHash), batch);
    expect(second.toInsert).toHaveLength(0);
    expect(second.duplicates).toHaveLength(3);
  });

  it('catches a duplicate inside one batch', async () => {
    /*
     * Some banks list a pending row and its settled twin in the same export.
     * Without this the unique index rejects the second insert and takes the
     * whole batch with it — a statement that fails to parse for a reason the
     * error message could not explain.
     */
    const batch = await prepare([row(), row(), row({ amount: 90 })]);
    const plan = planMerge([], batch);
    expect(plan.toInsert).toHaveLength(2);
    expect(plan.duplicates).toHaveLength(1);
  });

  it('marks duplicates rather than dropping them', async () => {
    const batch = await prepare([row()]);
    const plan = planMerge(batch.map((r) => r.dedupeHash), batch);
    expect(plan.duplicates[0].isDuplicate).toBe(true);
    // Kept, so a run can report "12 rows, 12 already seen" rather than "0 rows",
    // which would read as a parse failure.
    expect(plan.duplicates[0].description).toBe(row().description);
  });

  it('a genuine second transaction is not swallowed', async () => {
    // Same payee, same amount, same day — different reference. It must survive.
    const first = await prepare([row({ description: 'ADNOC AUTH 1' })]);
    const second = await prepare([row({ description: 'ADNOC AUTH 2' })]);
    const plan = planMerge(first.map((r) => r.dedupeHash), second);
    expect(plan.toInsert).toHaveLength(1);
  });

  it('does not mutate the batch it is given', async () => {
    const batch = await prepare([row()]);
    planMerge(batch.map((r) => r.dedupeHash), batch);
    expect(batch[0].isDuplicate).toBe(false);
  });
});

describe('runOutcome', () => {
  it('an empty statement is parsed, not failed', () => {
    // A dormant account with no activity is a legitimate result. Calling it
    // failed sends someone hunting for a problem that does not exist.
    expect(runOutcome(undefined, 0, 0)).toMatchObject({ status: 'parsed', transactionCount: 0 });
  });

  it('counts duplicates in the total, so the figure matches the statement', () => {
    // "12 rows, 9 new" is honest. Reporting 9 would suggest three rows were
    // lost somewhere between the file and the ledger.
    expect(runOutcome(undefined, 9, 3).transactionCount).toBe(12);
  });

  it('a failure carries a sentence', () => {
    const out = runOutcome('The PDF contains no extractable text.', 0, 0);
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toContain('no extractable text');
  });

  it('a failure never claims a transaction count', () => {
    expect(runOutcome('boom', 5, 5).transactionCount).toBe(0);
  });
});
