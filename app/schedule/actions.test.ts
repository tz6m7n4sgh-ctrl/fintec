import { describe, expect, it } from 'vitest';
import { deletePayment, savePayment } from './actions';

/**
 * HAD-81 — the derived-row write guard.
 *
 * School-fee terms reach the schedule as *derived* rows with a sentinel id
 * (`fee:<uuid>`). They have no `scheduled_payments` row behind them, and the id
 * column is a uuid, so a write against one is refused by Postgres:
 *
 *   22P02  invalid input syntax for type uuid: "fee:f2"
 *
 * That was verified against the live project, not assumed. Failing is correct —
 * a derived row must never be writable, or the app has two places to change one
 * number. What is not correct is that message reaching a person. The editor no
 * longer offers Edit or Delete on these rows at all; this is the second line,
 * for a stale page or a replayed form.
 *
 * These two cases return before any Supabase client is constructed, which is
 * what makes them assertable here at all. The rest of both actions needs a
 * session and stays in the manual pass (HAD-68).
 */

const form = (id: string): FormData => {
  const f = new FormData();
  f.set('id', id);
  f.set('dueDate', '2027-01-12');
  f.set('payee', 'GEMS school');
  f.set('amount', '12000');
  return f;
};

describe('derived rows are not writable', () => {
  it('saving a school-fee row is refused with a sentence, not a uuid error', async () => {
    const r = await savePayment({ ok: false }, form('fee:f2'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Loans & fees');
    expect(r.error).not.toContain('uuid');
  });

  it('deleting a school-fee row is refused the same way', async () => {
    const r = await deletePayment({ ok: false }, form('fee:f2'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Loans & fees');
  });

  it('a computed budget id is refused too', async () => {
    // `auto:*` rows are the same shape of thing on the budget screen. Nothing
    // routes them here today; the guard covers the id space rather than one id.
    expect((await deletePayment({ ok: false }, form('auto:schoolFees'))).ok).toBe(false);
  });

  it('an ordinary uuid is not caught by the guard', async () => {
    /*
     * The negative control, and the only one that makes the three above mean
     * anything: a guard that refused every id would pass them all.
     *
     * A real uuid must get *past* the guard, and what it hits next depends on
     * the environment rather than on this code — `cookies()` outside a request
     * scope where Supabase is configured, `NOT_CONFIGURED` where it is not.
     * Both are proof the guard let it through, so this asserts the one thing
     * true in either case: whatever went wrong, it was not the derived-row
     * refusal.
     */
    const outcome = await savePayment(
      { ok: false },
      form('3f1a7c2e-8b4d-4a19-9c05-1e2d3f4a5b6c'),
    ).catch((e: unknown) => ({ ok: false as const, error: String(e) }));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toContain('Loans & fees');
  });
});
