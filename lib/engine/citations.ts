/**
 * Where each rule comes from, and when somebody last checked.
 *
 * ## Why this exists with nothing in it
 *
 * `RULES` in `uae.ts` is a block of numbers. Every figure this app produces —
 * a gratuity, a settlement deadline, an ILOE entitlement — is one of those
 * numbers multiplied by something the user typed. The numbers are the app's
 * entire claim to be worth reading, and until now **nothing recorded where any
 * of them came from.**
 *
 * Phase 2 decision OD-1 resolved that there is no access to the current legal
 * text and no contact who can confirm it. So P2-4 downgraded from *a figure
 * good enough to take to HR* to *orient me, roughly*.
 *
 * The tempting response is to skip this file until a lawyer is available. That
 * is the wrong order. Without it the app has no way to *say* it is unsourced,
 * so it says nothing, and a figure that says nothing about its own basis reads
 * as authoritative. This project's signature failure is a plausible wrong
 * answer rather than a visible one; in law it is worse, because a wrong article
 * number quoted in an HR meeting destroys the user's credibility at the moment
 * they most need it.
 *
 * So: build the structure, populate nothing, and make the emptiness visible.
 * Every entry below is `null` on purpose. On the day the law text is available
 * the same structure fills in, the UI changes what it renders, and no figure
 * silently became more authoritative than its evidence.
 *
 * ## The half-citation is the dangerous state
 *
 * A provision with no verification date is worse than no citation at all: it
 * looks sourced. `citations.test.ts` fails on any entry that has one without
 * the other, and on any rule constant with no entry — so adding a number to
 * `RULES` without deciding its provenance breaks the build rather than
 * shipping quietly.
 */

import type { IsoDate } from './types';
import { RULES } from './uae';

/** Every constant the engine computes from. */
export type RuleKey = keyof typeof RULES;

export interface Citation {
  /** What this rule is, in words, so the UI can name an unverified basis. */
  label: string;
  /**
   * The provision it is taken from — an article of the decree-law, a cabinet
   * resolution, a scheme rule. `null` means nobody has sourced it.
   */
  provision: string | null;
  /**
   * The day a person last read this against the current legal text. `null`
   * means never — not "a while ago", not "probably fine".
   *
   * This is separate from `provision` because law changes underneath a correct
   * article number. UAE employment law was substantially rewritten in 2022;
   * a citation with no date cannot tell you whether it predates that.
   */
  verifiedOn: IsoDate | null;
}

/**
 * One entry per rule constant. All unsourced, deliberately.
 *
 * Keep this in the same order as `RULES` — the pairing is easier to audit by
 * eye than by test, and the test only proves the keys match, not that the
 * labels describe the right number.
 */
export const CITATIONS: Record<RuleKey, Citation> = {
  DAYS_PER_MONTH: {
    label: 'Converting a monthly salary to a daily rate',
    provision: null,
    verifiedOn: null,
  },
  DAYS_PER_YEAR: {
    label: 'Converting service days to years',
    provision: null,
    verifiedOn: null,
  },
  GRATUITY_DAYS_FIRST_5Y: {
    label: 'Gratuity accrual for the first five years',
    provision: null,
    verifiedOn: null,
  },
  GRATUITY_DAYS_AFTER_5Y: {
    label: 'Gratuity accrual beyond five years',
    provision: null,
    verifiedOn: null,
  },
  GRATUITY_MIN_YEARS: {
    label: 'Minimum service before any gratuity is owed',
    provision: null,
    verifiedOn: null,
  },
  GRATUITY_CAP_MONTHS: {
    label: 'The ceiling on total gratuity',
    provision: null,
    verifiedOn: null,
  },
  ILOE_RATE: {
    label: 'ILOE benefit as a share of basic salary',
    provision: null,
    verifiedOn: null,
  },
  ILOE_CATEGORY_THRESHOLD: {
    label: 'The salary threshold dividing ILOE category A from B',
    provision: null,
    verifiedOn: null,
  },
  ILOE_CAP_A: { label: 'ILOE monthly cap, category A', provision: null, verifiedOn: null },
  ILOE_CAP_B: { label: 'ILOE monthly cap, category B', provision: null, verifiedOn: null },
  ILOE_MAX_MONTHS: { label: 'How long ILOE pays for', provision: null, verifiedOn: null },
  SETTLEMENT_DUE_DAYS: {
    label: 'The window an employer has to settle',
    provision: null,
    verifiedOn: null,
  },
  ILOE_CLAIM_DAYS: {
    label: 'The window to claim ILOE, which cannot be recovered once missed',
    provision: null,
    verifiedOn: null,
  },
  CHEQUE_WINDOW_6M: {
    label: 'Cheque exposure window, six months',
    provision: null,
    verifiedOn: null,
  },
  CHEQUE_WINDOW_12M: {
    label: 'Cheque exposure window, twelve months',
    provision: null,
    verifiedOn: null,
  },
  OVERSTAY_AED_PER_DAY: {
    label: 'The daily penalty after the visa grace period',
    provision: null,
    verifiedOn: null,
  },
};

export type BasisStatus = 'verified' | 'unverified';

/**
 * A citation counts as verified only when it has both halves. Anything else is
 * unverified — including the half-sourced state, which the test forbids
 * outright but which this function still has to answer safely.
 */
export function basisStatus(key: RuleKey): BasisStatus {
  const c = CITATIONS[key];
  return c.provision !== null && c.verifiedOn !== null ? 'verified' : 'unverified';
}

/** Every rule nobody has sourced. Today: all of them. */
export function unverifiedRuleKeys(): RuleKey[] {
  return (Object.keys(CITATIONS) as RuleKey[]).filter((k) => basisStatus(k) === 'unverified');
}

/** True while no rule anywhere carries a provenance. */
export function isFullyUnverified(): boolean {
  return unverifiedRuleKeys().length === Object.keys(CITATIONS).length;
}

/**
 * The sentence shown beside any figure, in full.
 *
 * Deliberately not softened. "Approximate" or "indicative" would let a reader
 * assume somebody checked and rounded. Nobody checked.
 */
export const UNVERIFIED_BASIS =
  'Calculated by this app from rules that have not been checked against the current law. ' +
  'Confirm with your employer before relying on it.';

/** The short form, for a line under a single breakdown row. */
export const UNVERIFIED_BASIS_SHORT = 'Basis not verified.';
