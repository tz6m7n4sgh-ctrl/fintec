import Link from 'next/link';
import { Card, Empty, PageHead, RunwayStatusBadge, StatTile } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { formatDate } from '@/lib/engine/dates';
import { money, months } from '@/lib/format/money';

export default async function AnswerPage() {
  const m = await getReadModel();
  const r = m.readiness;
  return <>
    <PageHead title="Answer" sub={`What happens if your job ends ${formatDate(m.profile.expectedLastDay)}`} />
    {m.isSeedData && <Empty>Your answer is not ready because we do not have your figures yet. The example below shows what you will receive. <Link href="/profile">Tell us the essentials</Link>.</Empty>}
    <Card title="How long will my money last?" sub="Based on resources, essential spending and income after your last day">
      <div className="hero">
        <div><div className="hero-num tnum">{months(r.runway.runwayMonths)} <small>months</small></div><RunwayStatusBadge status={r.runway.status} /></div>
        <p className="hero-meta">You have {money(r.runway.totalResources)} available and an essential monthly burn of {money(r.runway.netMonthlyBurn)}.</p>
      </div>
    </Card>
    <div className="grid g3" style={{ marginTop: 14 }}>
      <StatTile label="Final settlement" value={money(r.settlement.finalSettlement)} foot="See how it is calculated" href="/report" />
      <StatTile label="Money available" value={money(r.runway.totalResources)} foot="Review your money" href="/money" />
      <StatTile label="Next steps" value={`${m.checklist.filter(x => !x.done).length}`} foot="Actions still to do" href="/plan" />
    </div>
  </>;
}
