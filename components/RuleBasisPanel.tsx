import { RULE_LIST } from '@/lib/engine/uae';

/** Makes absent legal evidence visible beside the figures that depend on it. */
export function RuleBasisPanel() {
  const sourced = RULE_LIST.filter((rule) => rule.provision !== null && rule.verifiedOn !== null);
  const fullyVerified = sourced.length === RULE_LIST.length;

  if (fullyVerified) {
    const latest = sourced.map((rule) => rule.verifiedOn!).sort().at(0);
    return (
      <aside className="rule-basis verified" aria-label="Calculation basis">
        <b>✓ Legal basis verified</b>
        <span>All calculation rules have a provision and verification date{latest ? ` (oldest check: ${latest})` : ''}.</span>
      </aside>
    );
  }

  return (
    <aside className="rule-basis unverified" aria-label="Unverified calculation basis">
      <b>◇ Basis unverified</b>
      <span>
        These figures are a rough orientation, not a legally sourced entitlement. The current
        UAE provisions have not been checked, so do not rely on them for an HR or legal decision.
      </span>
      <span className="rule-basis-count">
        {RULE_LIST.length - sourced.length} of {RULE_LIST.length} calculation rules have no verified source.
      </span>
    </aside>
  );
}
