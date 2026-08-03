import Link from 'next/link';
import { Card, Empty, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';

export default async function DocumentsPage() {
  const m = await getReadModel();
  const confirmed = m.transactions.filter(t => t.reviewStatus !== 'pending' && !t.isDuplicate).length;
  return <>
    <PageHead title="Documents" sub="Statements and records used to check your figures" />
    {m.uploads.length === 0
      ? <Empty>No documents yet. Uploading a statement lets us compare your plan with real spending; you can still use the rest of the app without one.</Empty>
      : <Card title="Bank statements" sub={`${m.uploads.length} uploaded · ${confirmed} confirmed transactions`}><p>Your documents remain separate from the answer until you review the extracted transactions.</p></Card>}
    <Card title="Use a statement when you are ready" sub="This detail is optional until you want actual-spending insights">
      <Link href="/statements" className="btn primary">Open statements and transactions</Link>
    </Card>
  </>;
}
