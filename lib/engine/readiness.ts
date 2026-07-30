/**
 * Readiness score (§6.8 / FR-H1).
 *
 * The spec called for a score out of 18 from "runway / ILOE / gratuity /
 * debt-ratio" but never gave the point split — recorded as gap G-2 / open
 * question OQ-2. This is the proposed rubric, written explicitly so it can be
 * argued with rather than buried in code:
 *
 *   Runway            0-6   the single biggest determinant of survival
 *   ILOE              0-4   three months of replacement income, or nothing
 *   Settlement        0-4   how many months of burn the settlement covers
 *   Debt ratio        0-4   debt service as a share of survival spend
 *                    ----
 *                      18
 *
 * Manual checklist toggles do not add points — they are tracked separately in
 * the action plan so the score stays a measure of financial position, not of
 * admin completed.
 */

import type { BudgetCategory, Debt, Readiness } from './types';
import { monthlyDebtService } from './uae';

export type ReadinessBand = 'STRONG' | 'MODERATE' | 'AT RISK';

export interface ScoreCriterion {
  key: 'runway' | 'iloe' | 'settlement' | 'debtRatio';
  label: string;
  score: number;
  max: number;
  /** Why this score, in the user's terms. */
  detail: string;
}

export interface ReadinessScore {
  total: number;
  max: number;
  band: ReadinessBand;
  criteria: ScoreCriterion[];
}

export const READINESS_MAX = 18;
export const BAND_THRESHOLDS = { STRONG_MIN: 14, MODERATE_MIN: 9 } as const;

export function readinessBand(total: number): ReadinessBand {
  if (total >= BAND_THRESHOLDS.STRONG_MIN) return 'STRONG';
  if (total >= BAND_THRESHOLDS.MODERATE_MIN) return 'MODERATE';
  return 'AT RISK';
}

function scoreRunway(months: number): ScoreCriterion {
  // Unlimited runway (no net burn) is full marks.
  const score = !Number.isFinite(months)
    ? 6
    : months >= 12 ? 6
    : months >= 9 ? 5
    : months >= 6 ? 4
    : months >= 4.5 ? 3
    : months >= 3 ? 2
    : months >= 1.5 ? 1
    : 0;
  const shown = Number.isFinite(months) ? `${months.toFixed(1)} months` : 'Unlimited';
  return {
    key: 'runway',
    label: 'Runway',
    score,
    max: 6,
    detail: `${shown} of survival spending covered.`,
  };
}

function scoreIloe(r: Readiness): ScoreCriterion {
  const { eligible, monthlyBenefit, iloeTotal } = r.iloe;
  if (!eligible) {
    return {
      key: 'iloe',
      label: 'ILOE cover',
      score: 0,
      max: 4,
      detail: 'Not eligible — no unemployment benefit to claim.',
    };
  }
  // How much of the monthly burn does the benefit replace?
  const burn = r.runway.netMonthlyBurn;
  const replacement = burn === 0 ? 1 : monthlyBenefit / burn;
  const score = replacement >= 0.6 ? 4 : replacement >= 0.4 ? 3 : replacement >= 0.25 ? 2 : 1;
  return {
    key: 'iloe',
    label: 'ILOE cover',
    score,
    max: 4,
    detail: `Eligible — AED ${Math.round(monthlyBenefit).toLocaleString('en-AE')}/month for 3 months (AED ${Math.round(iloeTotal).toLocaleString('en-AE')} total), replacing ${Math.round(replacement * 100)}% of monthly burn.`,
  };
}

function scoreSettlement(r: Readiness): ScoreCriterion {
  const burn = r.runway.netMonthlyBurn;
  const settlement = r.settlement.finalSettlement;
  const monthsCovered = burn === 0 ? Infinity : settlement / burn;
  const score = !Number.isFinite(monthsCovered)
    ? 4
    : monthsCovered >= 4 ? 4
    : monthsCovered >= 3 ? 3
    : monthsCovered >= 2 ? 2
    : monthsCovered >= 1 ? 1
    : 0;
  const shown = Number.isFinite(monthsCovered) ? `${monthsCovered.toFixed(1)} months` : 'unlimited';
  return {
    key: 'settlement',
    label: 'Final settlement',
    score,
    max: 4,
    detail: `AED ${Math.round(settlement).toLocaleString('en-AE')} — about ${shown} of survival spending.`,
  };
}

function scoreDebtRatio(debts: Debt[], categories: BudgetCategory[]): ScoreCriterion {
  const service = monthlyDebtService(debts);
  const survival = categories.reduce((s, c) => s + c.survivalAmount, 0);
  const ratio = survival === 0 ? 0 : service / survival;
  const score = ratio <= 0.15 ? 4 : ratio <= 0.25 ? 3 : ratio <= 0.35 ? 2 : ratio <= 0.5 ? 1 : 0;
  return {
    key: 'debtRatio',
    label: 'Debt burden',
    score,
    max: 4,
    detail: `Debt service is ${Math.round(ratio * 100)}% of survival spending (AED ${Math.round(service).toLocaleString('en-AE')} of AED ${Math.round(survival).toLocaleString('en-AE')}).`,
  };
}

export function scoreReadiness(
  r: Readiness,
  debts: Debt[],
  categories: BudgetCategory[],
): ReadinessScore {
  const criteria = [
    scoreRunway(r.runway.runwayMonths),
    scoreIloe(r),
    scoreSettlement(r),
    scoreDebtRatio(debts, categories),
  ];
  const total = criteria.reduce((s, c) => s + c.score, 0);
  return { total, max: READINESS_MAX, band: readinessBand(total), criteria };
}
