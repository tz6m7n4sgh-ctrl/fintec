import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEED_DEBTS, SEED_PAYMENTS, SEED_PROFILE, SEED_SCHOOL_FEES } from '@/lib/data/seed';
import {
  deadlines,
  finalSettlement,
  gratuity,
  iloeBenefit,
  leaveEncashment,
  monthlyDebtService,
  monthlySchoolFees,
  noticePayInLieu,
  servicePeriod,
} from './uae';

/**
 * The conformance fixture (`docs/spec/conformance.json`).
 *
 * ## Why this test exists rather than a document
 *
 * `docs/spec/` is written for a reader who may reimplement this system from
 * scratch. Prose is the weakest thing to hand such a reader: it cannot be run,
 * and it drifts the moment the engine changes.
 *
 * So the specification's numbers are asserted here. A reimplementation can feed
 * `conformance.json`'s `profile` into its own engine and compare against
 * `expected` — turning "read this and hope" into "run this and know". And on
 * this side, an engine change that alters any documented figure fails the build
 * rather than quietly making the specification wrong.
 *
 * ## Why the values are compared exactly
 *
 * `serviceYears` is `7.3319644079397674` and the gratuity carries the same
 * precision, because the divisor is 365.25 rather than 365 and the rate is 21
 * days per year. Rounding those in the fixture would hide a genuine
 * disagreement between two implementations behind a tolerance — and this is the
 * one document whose whole purpose is to expose disagreement.
 *
 * Money is rounded for display, never in the engine (invariant I-14).
 *
 * ## If this test fails
 *
 * Either the engine changed and the fixture must be regenerated, or the engine
 * changed and should not have. Decide which before regenerating: a fixture
 * updated reflexively is a specification that documents whatever the code
 * happens to do.
 */

const fixture = JSON.parse(readFileSync('docs/spec/conformance.json', 'utf8')) as {
  profile: Record<string, unknown>;
  expected: Record<string, unknown>;
};

describe('the conformance fixture describes the reference profile', () => {
  it('records the same inputs the seed uses', () => {
    /*
     * The fixture carries its own copy of the profile so a reimplementation
     * needs only this one file. That copy is a second source for one fact
     * (invariant I-8), which is exactly why it is asserted here rather than
     * trusted — if the seed moves and the fixture does not, this fails.
     */
    expect(fixture.profile).toEqual(SEED_PROFILE);
  });
});

describe('the engine still produces the documented figures', () => {
  const e = fixture.expected;

  it('service period', () => {
    expect(servicePeriod(SEED_PROFILE)).toEqual(e.servicePeriod);
  });

  it('gratuity, including the breakdown a user has to be able to restate', () => {
    expect(gratuity(SEED_PROFILE)).toEqual(e.gratuity);
  });

  it('leave encashment', () => {
    expect(leaveEncashment(SEED_PROFILE)).toBe(e.leaveEncashment);
  });

  it('notice pay in lieu', () => {
    expect(noticePayInLieu(SEED_PROFILE)).toBe(e.noticePayInLieu);
  });

  it('final settlement', () => {
    expect(finalSettlement(SEED_PROFILE)).toEqual(e.finalSettlement);
  });

  it('ILOE benefit, category and cap', () => {
    expect(iloeBenefit(SEED_PROFILE)).toEqual(e.iloe);
  });

  it('deadlines, including the hard ILOE window', () => {
    expect(deadlines(SEED_PROFILE, SEED_PAYMENTS)).toEqual(e.deadlines);
  });

  it('monthly debt service and school fees', () => {
    expect(monthlyDebtService(SEED_DEBTS)).toBe(e.monthlyDebtService);
    expect(monthlySchoolFees(SEED_SCHOOL_FEES)).toBe(e.monthlySchoolFees);
  });
});
