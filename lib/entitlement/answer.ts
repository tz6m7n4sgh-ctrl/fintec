import { deadlines, finalSettlement, gratuity } from '@/lib/engine/uae';
import type { IsoDate, Profile, ScheduledPayment } from '@/lib/engine/types';

/**
 * The small read model needed by the date-driven answer.
 *
 * This deliberately delegates every amount and date to the existing engine.
 * Keeping the screen adapter this boring prevents presentation work from
 * becoming a second implementation of the entitlement rules.
 */
export function entitlementFor(
  profile: Profile,
  lastDay: IsoDate,
  payments: ScheduledPayment[] = [],
) {
  const datedProfile = { ...profile, expectedLastDay: lastDay };

  return {
    lastDay,
    gratuity: gratuity(datedProfile),
    settlement: finalSettlement(datedProfile),
    deadlines: deadlines(datedProfile, payments),
  };
}

