/**
 * AED / en-AE formatting (NFR-2).
 *
 * Amounts are formatted with no decimal places by default: every figure in this
 * app is a monthly budget line or a lump sum where fils are noise. `precise`
 * exists for the few places a settlement figure is itemised.
 */

const AED_WHOLE = new Intl.NumberFormat('en-AE', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const AED_PRECISE = new Intl.NumberFormat('en-AE', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `220,479` — no currency symbol; the UI labels the unit once. */
/** Negative zero formats as "-0", which reads as a bug. Normalise it away. */
function norm(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

export function money(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return AED_WHOLE.format(norm(Math.round(n)));
}

/** `AED 220,479` for standalone figures. */
export function aed(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `AED ${money(n)}`;
}

export function moneyPrecise(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return AED_PRECISE.format(norm(n));
}

/** Signed, for deltas and shortfalls: `−55,521`. Uses a real minus sign. */
export function moneySigned(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = norm(Math.round(n));
  return r < 0 ? `−${money(Math.abs(r))}` : money(r);
}

/** Months, or "Unlimited" when runway is infinite (§11 edge case). */
export function months(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : 'Unlimited';
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
