/**
 * Read model for the screens.
 *
 * Today this resolves to the seed dataset. It is deliberately the ONLY place the
 * screens get data from, so swapping in the Supabase-backed repository is a
 * change to this file rather than to every page.
 *
 * `getReadModel()` is async on purpose: the Supabase implementation will be, and
 * making the pages await it now means no page has to change later.
 */

import { computeReadiness, currentSpend, survivalSpend } from '@/lib/engine/uae';
import { monthlyActuals, projectCash } from '@/lib/engine/projection';
import { scoreReadiness } from '@/lib/engine/readiness';
import type { MonthlyActual, Projection } from '@/lib/engine/projection';
import type { ReadinessScore } from '@/lib/engine/readiness';
import type {
  BudgetCategory,
  Debt,
  IncomeStream,
  Profile,
  Readiness,
  ScheduledPayment,
  SchoolFee,
} from '@/lib/engine/types';
import {
  SEED_ACCOUNTS,
  SEED_BUDGET,
  SEED_CHECKLIST,
  SEED_DEBTS,
  SEED_INCOME,
  SEED_PAYMENTS,
  SEED_PROFILE,
  SEED_SCHOOL_FEES,
  SEED_TRANSACTIONS,
  SEED_UPLOADS,
} from './seed';
import type { BankAccount, ChecklistItem, StatementUpload, Transaction } from './seed';

export interface ReadModel {
  profile: Profile;
  budget: BudgetCategory[];
  debts: Debt[];
  schoolFees: SchoolFee[];
  payments: ScheduledPayment[];
  income: IncomeStream[];
  accounts: BankAccount[];
  transactions: Transaction[];
  uploads: StatementUpload[];
  checklist: ChecklistItem[];

  // Derived
  readiness: Readiness;
  projection: Projection;
  actuals: MonthlyActual[];
  score: ReadinessScore;
  currentTotal: number;
  survivalTotal: number;
  /** True when the app is reading seeded data rather than a live database. */
  isSeedData: boolean;
}

/** True once Supabase credentials are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export async function getReadModel(): Promise<ReadModel> {
  const profile = SEED_PROFILE;
  const budget = SEED_BUDGET;
  const payments = SEED_PAYMENTS;

  const readiness = computeReadiness(profile, budget, payments);
  const projection = projectCash(readiness.runway, payments, profile.expectedLastDay);
  const actuals = monthlyActuals(SEED_TRANSACTIONS);
  const score = scoreReadiness(readiness, SEED_DEBTS, budget);

  return {
    profile,
    budget,
    debts: SEED_DEBTS,
    schoolFees: SEED_SCHOOL_FEES,
    payments,
    income: SEED_INCOME,
    accounts: SEED_ACCOUNTS,
    transactions: SEED_TRANSACTIONS,
    uploads: SEED_UPLOADS,
    checklist: SEED_CHECKLIST,

    readiness,
    projection,
    actuals,
    score,
    currentTotal: currentSpend(budget),
    survivalTotal: survivalSpend(budget),
    // The schema and RLS are live, but no rows are written yet, so the screens
    // still read the seed. Surfaced in the UI rather than hidden.
    isSeedData: true,
  };
}

/** Resolves a checklist item's symbolic deadline to a real date. */
export function resolveDeadline(
  key: ChecklistItem['deadlineKey'],
  m: ReadModel,
): { date?: string; label: string } {
  switch (key) {
    case 'beforeLastDay':
      return { date: m.profile.expectedLastDay, label: 'Before last day' };
    case 'lastDay':
      return { date: m.profile.expectedLastDay, label: 'On last day' };
    case 'settlementDue':
      return { date: m.readiness.deadlines.settlementDue, label: 'Settlement due' };
    case 'iloeDeadline':
      return { date: m.readiness.deadlines.iloeDeadline, label: 'ILOE deadline — hard' };
    case 'visaGraceEnd':
      return { date: m.readiness.deadlines.visaGraceEnd, label: 'Visa grace ends' };
    case 'healthCoverEnd':
      return { label: `${m.profile.healthCoverMonthsAfterEnd} month(s) after last day` };
    case 'recurring':
      return { label: 'Weekly / monthly' };
    default:
      return { label: '—' };
  }
}
