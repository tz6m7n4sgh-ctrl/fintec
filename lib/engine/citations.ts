/**
 * Reading the evidence attached to each rule.
 *
 * The provenance itself lives on the constants in `uae.ts` — `RULES.X.provision`
 * and `RULES.X.verifiedOn` — rather than in a table here. This file is only the
 * lens over it: which rules are unsourced, whether any are, and the words the UI
 * says about it.
 *
 * ## Why the evidence is not in this file
 *
 * It was, in the first draft: a `Record<RuleKey, Citation>` sitting alongside
 * `RULES`, kept honest by a test asserting the two had matching keys.
 *
 * A parallel table works right up until it does not. Somebody adds a constant,
 * the table does not grow, and the new number quietly has no basis — the test
 * catches that, but only after the fact, and only because somebody remembered to
 * write it. Attaching the evidence to the value makes the failure earlier and
 * louder: `rule()` takes all four arguments, so a constant without provenance
 * does not compile at all.
 *
 * That design came from a parallel implementation of this ticket (PR #56) and is
 * better than what this file originally did. What survives from the first draft
 * is the half-citation test below, which that version did not have.
 */

import { RULES, type Rule } from './uae';

/** Every constant the engine computes from. */
export type RuleKey = keyof typeof RULES;

export type BasisStatus = 'verified' | 'unverified';

export const RULE_KEYS = Object.keys(RULES) as RuleKey[];

/** Every rule, paired with its key, for anything that needs to name them. */
export function ruleEntries(): [RuleKey, Rule][] {
  return RULE_KEYS.map((k) => [k, RULES[k] as Rule]);
}

/**
 * A citation counts as verified only when it has both halves.
 *
 * Anything else is unverified — including the half-sourced state, which
 * `citations.test.ts` forbids outright but which this still has to answer
 * safely rather than optimistically.
 */
export function basisStatus(key: RuleKey): BasisStatus {
  const r = RULES[key] as Rule;
  return r.provision !== null && r.verifiedOn !== null ? 'verified' : 'unverified';
}

/** Every rule nobody has sourced. Today: all of them. */
export function unverifiedRuleKeys(): RuleKey[] {
  return RULE_KEYS.filter((k) => basisStatus(k) === 'unverified');
}

/** True while no rule anywhere carries a provenance. */
export function isFullyUnverified(): boolean {
  return unverifiedRuleKeys().length === RULE_KEYS.length;
}

/**
 * How many rules are unsourced, out of how many.
 *
 * Shown in the panel because "unverified" alone invites the reading that one
 * detail is missing. Sixteen of sixteen is a different statement.
 */
export function unverifiedCount(): { unverified: number; total: number } {
  return { unverified: unverifiedRuleKeys().length, total: RULE_KEYS.length };
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
