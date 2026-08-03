import Link from 'next/link';
import { Card, Empty, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';

export default async function YouPage() {
  const m = await getReadModel();
  return <>
    <PageHead title="You" sub="Your details, account and preferences" />
    {m.isSeedData && <Empty>Your personal details are empty, so the app is using a worked example. Six essentials are enough to produce your first answer. <Link href="/profile">Add your details</Link>.</Empty>}
    <div className="grid g2">
      <Card title="Your situation" sub="Employment, salary, savings and household"><p>These details power your settlement, deadlines and runway.</p><Link href="/profile" className="btn primary">Review your details</Link></Card>
      <Card title="Account and preferences" sub="Security, reminders and your data"><p>Manage sign-in, notifications, exports and deletion in one place.</p><Link href="/settings" className="btn">Open settings</Link></Card>
    </div>
  </>;
}
