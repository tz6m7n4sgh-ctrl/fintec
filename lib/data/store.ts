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

import { createClient, getUser } from '@/lib/supabase/server';
import { loadLiveData } from './repository';
import type { LiveData } from './repository';
import { computeReadiness, currentSpend, schoolFeeObligations, survivalSpend } from '@/lib/engine/uae';
import { monthlyActuals, projectCash } from '@/lib/engine/projection';
import { applySettlement } from '@/lib/engine/settle';
import { remindersWithin, type Reminder } from '@/lib/engine/reminders';
import { todayInDubai } from '@/lib/engine/dates';
import { DEFAULT_PREFS, type NotificationPrefs } from '@/lib/settings/notifications';
import type { CategoryRule } from '@/lib/engine/categorise';
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
  SEED_CATEGORY_RULES,
  SEED_UPLOADS,
} from './seed';
import type { BankAccount, ChecklistItem, StatementUpload, Transaction } from './seed';

/** The signed-in user, reduced to what the screens actually display. */
export interface SessionUser {
  id: string;
  email: string | null;
}

export interface ReadModel {
  /** Null when signed out, or when Supabase is not configured. */
  user: SessionUser | null;
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
  /** Keyword categorisation rules (US-32). Proposals derive from these. */
  categoryRules: CategoryRule[];
  /** Reminder settings (US-44). Defaults when no row exists. */
  notificationPrefs: NotificationPrefs;
  /**
   * What US-16 would send, computed from the payments above.
   *
   * On the read model rather than per screen because three of them want it: the
   * calendar draws a marker on every `sendOn`, Settings previews what is
   * coming, and `missed` is a warning the dashboard should be able to raise.
   */
  reminders: Reminder[];

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

/** The §11 reference dataset, used whenever there is no live data to show. */
const SEED_DATA: LiveData = {
  profile: SEED_PROFILE,
  budget: SEED_BUDGET,
  debts: SEED_DEBTS,
  schoolFees: SEED_SCHOOL_FEES,
  payments: SEED_PAYMENTS,
  income: SEED_INCOME,
  accounts: SEED_ACCOUNTS,
  transactions: SEED_TRANSACTIONS,
  uploads: SEED_UPLOADS,
  categoryRules: SEED_CATEGORY_RULES,
  checklist: SEED_CHECKLIST,
  notificationPrefs: DEFAULT_PREFS,
};

export async function getReadModel(): Promise<ReadModel> {
  const authUser = await getUser();
  const user: SessionUser | null = authUser
    ? { id: authUser.id, email: authUser.email ?? null }
    : null;

  // `isSeedData` is DERIVED, never assigned by hand. It is true whenever the
  // figures on screen are the reference dataset rather than the user's own —
  // whether that is because nobody is signed in, or because a signed-in user
  // has not entered anything yet. Hand-flipping this to false the moment reads
  // existed would have recreated exactly the defect HAD-58 was about: a status
  // claim nothing computes.
  let data = SEED_DATA;
  let isSeedData = true;

  if (user) {
    const supabase = await createClient();
    if (supabase) {
      const live = await loadLiveData(supabase);
      /*
       * A profile row is not enough to go live on. Runway is resources divided
       * by monthly burn, and burn comes entirely from `budget`. With no budget
       * rows the burn is zero, and zero burn does not read as "no data":
       * `uae.ts:220` returns `Infinity`, the hero tile prints **"Unlimited"**,
       * and `scoreRunway` awards the **full 6 of 6** — so the readiness score
       * is inflated at the same time.
       *
       * That is the worst output this app can produce: a confident wrong answer
       * in the reassuring direction, on the one screen someone opens to find
       * out how long their savings actually last.
       *
       * There is no per-user budget seeding yet and the budget screen is still
       * read-only (US-23, HAD-19), so until a user can enter spending there is
       * nothing to go live *on*. Staying on the seed keeps the "Reference data"
       * banner up, which is the honest thing to show.
       */
      if (live && live.budget.length > 0) {
        data = live;
        isSeedData = false;
      }
    }
  }

  const { profile, budget, schoolFees } = data;

  /*
   * The §8 action plan, with each item's stored done state laid over it
   * (HAD-85). The list itself always comes from SEED_CHECKLIST — the items are
   * legal and procedural steps, not user content, so a correction to the ILOE
   * wording or its deadline must reach a user who signed up last year. Only the
   * boolean is theirs.
   */
  const doneByKey = new Map(data.checklist.map((c) => [c.id, c.done]));
  const checklist = SEED_CHECKLIST.map((item) => ({
    ...item,
    done: doneByKey.get(item.id) ?? item.done,
  }));

  /*
   * School-fee terms are obligations too, and until now nothing but the budget
   * knew it — see HAD-81. Derived here rather than stored twice, so the
   * calendar, the cheque exposure tiles and the projection all see one source.
   */
  /*
   * Settlement is applied last, over the composed list (US-18 / HAD-14). A
   * confirmed transaction that names a payment marks it paid by *derivation* —
   * nothing writes `status`, so removing the match reverts it for free and a
   * stored `atRisk` is never destroyed. See `lib/engine/settle.ts`.
   */
  const payments = applySettlement(
    [...data.payments, ...schoolFeeObligations(schoolFees)],
    data.transactions,
  );

  const readiness = computeReadiness(profile, budget, payments, data.income);
  const projection = projectCash(readiness.runway, payments, profile.expectedLastDay);
  const actuals = monthlyActuals(data.transactions);
  const score = scoreReadiness(readiness, data.debts, budget);

  return {
    user,
    ...data,

    /*
     * After `...data`, deliberately. The spread carries the raw stored
     * payments, and every screen that lists or counts obligations reads this
     * field — while `readiness` above was computed from the composed list.
     *
     * Leaving the spread to win produced exactly the defect this project keeps
     * repeating: the dashboard's cheque tile showed 113,000 (composed) beside
     * a caption reading "4 cheques" (raw). One obligation, two numbers, both
     * plausible. The e2e test that pins the tile's figure against its own
     * caption is what caught it.
     */
    payments,
    checklist,
    notificationPrefs: data.notificationPrefs,
    /*
     * Computed from the composed payment list, so school-fee terms and settled
     * cheques are already accounted for — and from `todayInDubai`, because a
     * reminder that fires on the server's local day is a reminder that fires on
     * the wrong day for eight months of the year (R-7).
     */
    reminders: remindersWithin(
      payments,
      todayInDubai(),
      data.notificationPrefs.leadDays,
    ),

    readiness,
    projection,
    actuals,
    score,
    currentTotal: currentSpend(budget),
    survivalTotal: survivalSpend(budget),
    isSeedData,
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
