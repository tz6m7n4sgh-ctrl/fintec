'use client';

import { useId, useState } from 'react';
import { formatDate } from '@/lib/engine/dates';
import type { Profile, ScheduledPayment } from '@/lib/engine/types';
import { entitlementFor } from '@/lib/entitlement/answer';
import { aed, moneyPrecise } from '@/lib/format/money';

function Figure({ profile, payments, date }: { profile: Profile; payments: ScheduledPayment[]; date: string }) {
  const answer = entitlementFor(profile, date, payments);
  const { gratuity, settlement, deadlines } = answer;
  const items = [
    ['End-of-service gratuity', settlement.gratuity],
    ['Unused leave', settlement.leaveEncashment],
    ['Notice paid in lieu', settlement.noticePayInLieu],
    ['Other amounts owed to you', settlement.otherOwedToEmployee],
    ['Less: amounts you owe the employer', -settlement.owedToEmployer],
  ] as const;

  return (
    <article className="answer-figure">
      <p className="answer-kicker">If your last day were {formatDate(date)}, this app calculates</p>
      <div className="answer-total tnum"><span>AED</span> {moneyPrecise(settlement.finalSettlement)}</div>
      <p className="answer-caption">Estimated final settlement from your saved answers</p>

      <div className="basis-warning" role="note">
        <span aria-hidden>!</span>
        <div><b>Legal basis unverified</b><br />These rules do not yet have a sourced provision or verification date. Use this as an orientation, not a legal entitlement. Confirm the figure with your employer or MOHRE.</div>
      </div>

      {gratuity.ineligible && (
        <div className="answer-state" role="status">
          <b>No gratuity yet</b>
          <span>Your service on this date is under one year. The other settlement items still count.</span>
        </div>
      )}
      {gratuity.capApplied && (
        <div className="answer-state" role="status">
          <b>Gratuity cap applied</b>
          <span>The engine limited gratuity to 24 months of basic salary: {aed(gratuity.gratuityCap)}.</span>
        </div>
      )}

      <dl className="answer-breakdown">
        {items.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd className="tnum">{value < 0 ? `−${moneyPrecise(Math.abs(value))}` : moneyPrecise(value)}</dd></div>
        ))}
        <div className="answer-breakdown-total"><dt>Total</dt><dd className="tnum">AED {moneyPrecise(settlement.finalSettlement)}</dd></div>
      </dl>

      <div className="answer-deadlines">
        <h3>What happens next</h3>
        <div><time dateTime={deadlines.settlementDue}>{formatDate(deadlines.settlementDue)}</time><span>Employer settlement due · 14 days after your last day</span></div>
        <div><time dateTime={deadlines.iloeDeadline}>{formatDate(deadlines.iloeDeadline)}</time><span>ILOE claim deadline · 30 days after your last day</span></div>
        <div><time dateTime={deadlines.visaGraceEnd}>{formatDate(deadlines.visaGraceEnd)}</time><span>Saved visa grace period ends</span></div>
      </div>
    </article>
  );
}

export function EntitlementAnswer({ profile, payments }: { profile: Profile; payments: ScheduledPayment[] }) {
  const firstId = useId();
  const secondId = useId();
  const [date, setDate] = useState(profile.expectedLastDay);
  const [comparing, setComparing] = useState(false);
  const [compareDate, setCompareDate] = useState('');

  return (
    <>
      <section className="answer-controls" aria-label="Choose last working day">
        <label htmlFor={firstId}>Your last working day</label>
        <input id={firstId} type="date" value={date} min={profile.employmentStart} onChange={(event) => setDate(event.target.value)} />
        {!comparing ? (
          <button className="btn secondary" type="button" onClick={() => setComparing(true)}>Compare another date</button>
        ) : (
          <>
            <label htmlFor={secondId}>Compare with</label>
            <input id={secondId} type="date" value={compareDate} min={profile.employmentStart} onChange={(event) => setCompareDate(event.target.value)} />
            <button className="text-button" type="button" onClick={() => { setComparing(false); setCompareDate(''); }}>Stop comparing</button>
          </>
        )}
      </section>

      <div className={compareDate ? 'answer-grid comparing' : 'answer-grid'}>
        <Figure profile={profile} payments={payments} date={date} />
        {comparing && !compareDate && (
          <div className="compare-empty"><b>Choose a second date</b><span>We will show both engine answers side by side. No comparison date is assumed for you.</span></div>
        )}
        {compareDate && <Figure profile={profile} payments={payments} date={compareDate} />}
      </div>
    </>
  );
}

