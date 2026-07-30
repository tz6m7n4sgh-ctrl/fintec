import { Card, Empty, PageHead } from '@/components/ui';
import { formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { money } from '@/lib/format/money';

const STATUS_PILL: Record<string, { cls: string; icon: string; label: string }> = {
  uploaded: { cls: 'pill', icon: '↥', label: 'Uploaded' },
  queued: { cls: 'pill', icon: '◌', label: 'Queued' },
  processing: { cls: 'pill', icon: '◐', label: 'Processing' },
  parsed: { cls: 'pill ok', icon: '✓', label: 'Parsed' },
  failed: { cls: 'pill cheque', icon: '✕', label: 'Failed' },
  reviewed: { cls: 'pill ok', icon: '✓', label: 'Reviewed' },
};

export default async function StatementsPage() {
  const m = await getReadModel();
  const accountName = (id: string) => {
    const a = m.accounts.find((x) => x.id === id);
    return a ? `${a.bankName} ··${a.last4}` : '—';
  };

  const pending = m.transactions.filter((t) => t.reviewStatus === 'pending' && !t.isDuplicate);
  const confirmed = m.transactions.filter((t) => t.reviewStatus !== 'pending' && !t.isDuplicate);

  return (
    <>
      <PageHead
        title="Bank statements & transactions"
        sub="Upload a statement, review what was parsed, then it counts toward your dashboards"
      />

      <Card title="How ingestion works" sub="Scheduled parsing job">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1)' }} aria-hidden>1</span>
            <span>You upload a PDF, CSV or XLSX. It goes straight to a <b>private storage bucket</b> namespaced to your user id — never a public URL.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1)' }} aria-hidden>2</span>
            <span>A <b>scheduled Claude Cowork session</b> picks up queued files, extracts the transactions, dedupes them and proposes categories and payment matches.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1)' }} aria-hidden>3</span>
            <span>Everything lands in the <b>review inbox</b> as pending. Nothing moves a dashboard figure until you confirm it.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--warning)' }} aria-hidden>▲</span>
            <span>Statement contents are read by an LLM in step 2. This is the open decision <b>OQ-1</b> — whether to keep a deterministic no-LLM path for sensitive files.</span>
          </li>
        </ul>
      </Card>

      <Card title="Uploads" sub={`${m.uploads.length} files · re-uploading the same file creates zero duplicate transactions`}>
        <div className="tbl-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th>File</th><th>Account</th><th>Period</th><th>Type</th>
                <th className="r">Rows</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {m.uploads.map((u) => {
                const s = STATUS_PILL[u.status];
                return (
                  <tr key={u.id}>
                    <td className="payee">
                      {u.fileName}
                      {u.errorMessage ? <span className="sub" style={{ color: 'var(--critical)' }}>{u.errorMessage}</span> : null}
                    </td>
                    <td>{accountName(u.bankAccountId)}</td>
                    <td className="mono">
                      {u.periodStart && u.periodEnd
                        ? `${formatDate(u.periodStart)} – ${formatDate(u.periodEnd)}`
                        : '—'}
                    </td>
                    <td><span className="pill">{u.fileType.toUpperCase()}</span></td>
                    <td className="r mono">{u.transactionCount ?? '—'}</td>
                    <td><span className={s.cls}><span aria-hidden>{s.icon}</span> {s.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Review inbox"
        sub={`${pending.length} transactions pending — these do NOT count in any dashboard figure yet`}
      >
        {pending.length === 0 ? (
          <Empty>Nothing to review. New parsed transactions will appear here.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="wide">
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Account</th>
                  <th className="r">Amount</th><th>Proposed match</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((t) => {
                  const match = t.matchedScheduledPaymentId
                    ? m.payments.find((p) => p.id === t.matchedScheduledPaymentId)
                    : undefined;
                  return (
                    <tr key={t.id}>
                      <td className="mono">{formatDate(t.date)}</td>
                      <td className="payee">{t.description}</td>
                      <td>{accountName(t.bankAccountId)}</td>
                      <td className="r amt mono">
                        {t.direction === 'debit' ? '−' : '+'}{money(t.amount)}
                      </td>
                      <td>
                        {match
                          ? <span className="pill ok"><span aria-hidden>✓</span> {match.payee}</span>
                          : <span className="pill">Uncategorised</span>}
                      </td>
                      <td><button className="btn" disabled>Confirm</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="legend">
          <span className="key">Bulk confirm becomes available once sign-in and persistence are wired up.</span>
        </div>
      </Card>

      <Card title="Transactions ledger" sub={`${confirmed.length} confirmed transactions`}>
        <div className="filters">
          <select disabled defaultValue=""><option value="">All accounts</option></select>
          <select disabled defaultValue=""><option value="">All categories</option></select>
          <select disabled defaultValue=""><option value="">All directions</option></select>
          <input disabled placeholder="Search description" />
        </div>
        <div className="tbl-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Account</th>
                <th className="r">Amount</th><th>Direction</th><th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...confirmed]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{formatDate(t.date)}</td>
                    <td className="payee">{t.description}</td>
                    <td>{accountName(t.bankAccountId)}</td>
                    <td className="r amt mono">{money(t.amount)}</td>
                    <td>
                      {t.direction === 'credit'
                        ? <span className="pill ok">Credit</span>
                        : <span className="pill">Debit</span>}
                    </td>
                    <td><span className="pill">{t.source === 'statement' ? 'Statement' : 'Manual'}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
