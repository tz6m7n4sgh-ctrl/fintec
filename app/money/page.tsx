import Link from 'next/link';
import { Card, Empty, PageHead, StatTile } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { money } from '@/lib/format/money';

export default async function MoneyPage() {
  const m = await getReadModel();
  return <>
    <PageHead title="Money" sub="What comes in, what goes out, and what is due" />
    {m.isSeedData && <Empty>This section is showing an example because you have not added your money yet. Start with your salary and savings; we will ask for bills and debts only when they are needed. <Link href="/profile">Add salary and savings</Link>.</Empty>}
    <div className="grid g3">
      <StatTile label="Essential monthly spending" value={money(m.survivalTotal)} foot="Review budget" href="/budget" />
      <StatTile label="Debts" value={`${m.debts.length}`} foot="Loans and repayments" href="/loans" />
      <StatTile label="Upcoming payments" value={`${m.payments.filter(p => p.status !== 'paid').length}`} foot="See calendar" href="/calendar" />
    </div>
    <Card title="Add detail when it becomes useful" sub="You do not need to complete a ten-part setup before seeing an answer">
      <ul className="insights">
        <li><span className="ic" aria-hidden>1</span><span><b>Start with essentials.</b> <Link href="/budget">Add the spending</Link> you could not pause after leaving work.</span></li>
        <li><span className="ic" aria-hidden>2</span><span><b>Add commitments next.</b> <Link href="/loans">Record loans, school fees and cheques</Link> so dates and lump sums become accurate.</span></li>
        <li><span className="ic" aria-hidden>3</span><span><b>Plan exact dates only if needed.</b> <Link href="/schedule">Manage the payment schedule</Link>.</span></li>
      </ul>
    </Card>
  </>;
}
