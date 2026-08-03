import { describe, expect, it } from 'vitest';
import type { MergePlan, PreparedRow } from './dedupe';
import { noticeFor, periodOf, withMergeLog } from './report';

const row = (date: string, hash: string): PreparedRow => ({
  bankAccountId: 'acct-1',
  date,
  description: 'X',
  amount: 1,
  direction: 'debit',
  dedupeHash: hash,
  isDuplicate: false,
});

const plan = (inserted: number, duplicates: number): MergePlan => ({
  toInsert: Array.from({ length: inserted }, (_, i) => row('2026-08-03', `new-${i}`)),
  duplicates: Array.from({ length: duplicates }, (_, i) => row('2026-08-03', `old-${i}`)),
});

describe('withMergeLog', () => {
  it('reports what was added and what was already there, separately', () => {
    /*
     * "Imported 96 transactions" after a re-upload that inserted four is true
     * of neither number, and both matter: the four are what changed, the
     * ninety-six are what the file contained.
     */
    const log = withMergeLog([], plan(4, 92));
    expect(log.map((e) => e.message).join(' ')).toMatch(/92 transactions were already/);
    expect(log.map((e) => e.message).join(' ')).toMatch(/4 transactions added/);
  });

  it('says plainly that a re-upload changed nothing', () => {
    // US-30, made visible rather than left to the tests.
    const log = withMergeLog([], plan(0, 12));
    expect(log[0].message).toMatch(/All 12 transactions in this file were already/);
    expect(log[0].message).toMatch(/Re-uploading a statement is safe/);
  });

  it('does not mention duplicates when there were none', () => {
    const log = withMergeLog([], plan(3, 0));
    expect(log.some((e) => /already in the ledger/.test(e.message))).toBe(false);
  });

  it('gets the singular right', () => {
    const log = withMergeLog([], plan(1, 1));
    const text = log.map((e) => e.message).join(' ');
    expect(text).toMatch(/1 transaction was already/);
    expect(text).toMatch(/1 transaction added, waiting for you to confirm it/);
  });

  it('keeps the parser log ahead of its own lines', () => {
    const log = withMergeLog([{ level: 'info', message: 'Read 3 transactions from 3 rows.' }], plan(3, 0));
    expect(log[0].message).toMatch(/Read 3 transactions/);
  });
});

describe('periodOf', () => {
  it('reads the span from the transactions, not from a preamble line', () => {
    /*
     * The "Statement period …" line is prose in an unspecified format, and
     * parsing it would be a second, weaker date parser whose disagreements with
     * the first show up as a period that does not contain its own transactions.
     */
    expect(periodOf([row('2026-08-17', 'a'), row('2026-08-03', 'b'), row('2026-08-09', 'c')])).toEqual({
      start: '2026-08-03',
      end: '2026-08-17',
    });
  });

  it('handles a single transaction', () => {
    expect(periodOf([row('2026-08-03', 'a')])).toEqual({ start: '2026-08-03', end: '2026-08-03' });
  });

  it('is null when there is nothing to span', () => {
    expect(periodOf([])).toBeNull();
  });
});

describe('noticeFor', () => {
  it('passes a parse error straight through', () => {
    expect(noticeFor('That file has no header row.', null)).toMatch(/no header row/);
  });

  it('says nothing was added when everything was a duplicate', () => {
    expect(noticeFor(undefined, plan(0, 5))).toMatch(/already in your ledger/);
  });

  it('names the count waiting for review', () => {
    expect(noticeFor(undefined, plan(5, 0))).toMatch(/5 transactions imported/);
  });

  it('stays quiet when there is nothing to say', () => {
    // An empty month on a dormant account is a legitimate outcome, not news.
    expect(noticeFor(undefined, plan(0, 0))).toBeUndefined();
  });
});
