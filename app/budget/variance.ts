import { money } from '@/lib/format/money';

/**
 * Budget vs actual, per category (US-25 / HAD-53).
 *
 * The table's "Difference" column compares the two *plans* — current against
 * survival — which says what switching would save, not how the month actually
 * went. This is the other comparison: what was really spent (the confirmed,
 * non-duplicate statement average) against what the current plan budgeted.
 *
 * Sign convention: positive means spending **over** plan, negative under. The
 * label says which in words, because a bare signed number next to a column of
 * other signed numbers is exactly how a reader inverts it — and colour alone
 * is not allowed to carry the meaning (NFR-4).
 */

/**
 * Actual minus current plan, or `null` where there is no actual to compare —
 * a category no confirmed transaction has ever landed in, or a dataset with
 * no statement months at all. `null` rather than 0: "we spent exactly to
 * plan" and "we have nothing to compare" must not render the same.
 */
export function varianceVsPlan(
  actualPerMonth: number | undefined,
  currentAmount: number,
): number | null {
  if (actualPerMonth === undefined) return null;
  return actualPerMonth - currentAmount;
}

/**
 * What the cell says. Rounded to whole dirhams first — the table shows whole
 * dirhams, so a variance of 40 fils would otherwise render as "over" with an
 * amount of 0.
 */
export function varianceLabel(variance: number | null): string {
  if (variance === null) return '—';
  const r = Math.round(variance);
  if (r === 0) return 'on plan';
  return r > 0 ? `+${money(r)} over` : `−${money(-r)} under`;
}

/** The ink that agrees with the words: over plan is bad, under plan is good. */
export function varianceInk(variance: number | null): string | undefined {
  if (variance === null) return undefined;
  const r = Math.round(variance);
  if (r === 0) return undefined;
  return r > 0 ? 'var(--critical-ink)' : 'var(--good-ink)';
}
