/**
 * Keyword categorisation (US-32 / FR-L5).
 *
 * `category_rules` has existed since `0001` — with a priority column, a
 * per-user keyword uniqueness constraint and RLS — and **nothing in the app
 * ever loaded it.** The fourth column of its kind found this session, after
 * `dedupe_hash`, `matched_scheduled_payment_id` and `atRisk`.
 *
 * ## A proposal, like the payment matcher
 *
 * A rule suggests a category on a **pending** transaction. Nothing is written
 * until the user confirms, and confirming with a changed category records
 * `edited` rather than `confirmed` (US-31). So a bad rule costs a dropdown, not
 * a wrong figure.
 *
 * That also makes the third acceptance criterion — *"rules re-runnable over
 * existing transactions"* — free for anything still pending: the proposal is
 * derived at render time, so editing a rule changes every pending suggestion
 * immediately. There is no re-run to invoke because nothing was stored.
 *
 * The only case needing an explicit action is a row **already confirmed with no
 * category**, and that action must never overwrite a category the user chose.
 */

export interface CategoryRule {
  id: string;
  /** Matched case-insensitively as a substring of the description. */
  keyword: string;
  categoryId: string;
  /** Lower runs first. The column defaults to 100, leaving room either side. */
  priority: number;
}

/**
 * The rule that claims a description, or none.
 *
 * Ordering is fully deterministic, which matters more than it looks: the same
 * statement categorised twice must produce the same answer, or a re-parse
 * silently reshuffles somebody's spending history.
 *
 * 1. **Lower `priority` first** — the user's explicit ordering.
 * 2. **Then the longer keyword.** `ADCB CAR LOAN` is more specific than `ADCB`,
 *    and specificity is what the user meant by writing the longer one.
 * 3. **Then the keyword alphabetically**, so two equally specific rules at the
 *    same priority still resolve the same way every time rather than depending
 *    on row order from the database.
 */
export function matchRule(
  description: string,
  rules: CategoryRule[],
): CategoryRule | undefined {
  const haystack = description.toUpperCase();

  return [...rules]
    .filter((r) => r.keyword.trim() !== '' && haystack.includes(r.keyword.trim().toUpperCase()))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.keyword.length - a.keyword.length ||
        a.keyword.localeCompare(b.keyword),
    )[0];
}

/** The category a description falls into, if any rule claims it. */
export function categorise(description: string, rules: CategoryRule[]): string | undefined {
  return matchRule(description, rules)?.categoryId;
}

/**
 * Which rules would never fire, because a higher-precedence rule always wins.
 *
 * Worth surfacing in the editor rather than leaving the user to wonder. Someone
 * who writes `ADCB` at priority 10 and then `ADCB CAR LOAN` at priority 20 has
 * made the second rule dead, and the app knows it — the shadowing rule is
 * shorter *and* higher precedence, so nothing the longer one matches can ever
 * reach it.
 *
 * Only reports a rule as shadowed when the shadow is total. Two rules that
 * merely overlap on some descriptions are a legitimate arrangement.
 */
export function shadowedRules(rules: CategoryRule[]): CategoryRule[] {
  return rules.filter((rule) =>
    rules.some(
      (other) =>
        other.id !== rule.id &&
        other.keyword.trim() !== '' &&
        // Every description matching `rule` also matches `other`…
        rule.keyword.toUpperCase().includes(other.keyword.trim().toUpperCase()) &&
        // …and `other` wins the ordering above, so `rule` can never be reached.
        (other.priority < rule.priority ||
          (other.priority === rule.priority &&
            other.keyword.length > rule.keyword.length)),
    ),
  );
}
