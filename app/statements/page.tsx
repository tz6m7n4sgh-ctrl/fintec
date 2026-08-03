import { Card, Empty, PageHead } from '@/components/ui';
import { TransactionsLedger } from './TransactionsLedger';
import { ProcessingLog } from './ProcessingLog';
import { UploadsEditor } from './UploadsEditor';
import { ReviewInbox } from './ReviewInbox';
import { propose } from '@/lib/engine/match';
import { categorise } from '@/lib/engine/categorise';
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
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>1</span>
            <span>You upload a PDF, CSV or XLSX. It goes straight to a <b>private storage bucket</b> namespaced to your user id — never a public URL.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>2</span>
            <span>A <b>scheduled Claude Cowork session</b> picks up queued files, extracts the transactions, dedupes them and proposes categories and payment matches.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>3</span>
            <span>Everything lands in the <b>review inbox</b> as pending. Nothing moves a dashboard figure until you confirm it.</span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--warning)' }} aria-hidden>▲</span>
            <span>
              <b>Every statement you upload is read by an LLM</b> in step 2 — including PDFs, CSVs
              and spreadsheets. There is deliberately no local-only parsing mode. Files stay in a
              private bucket and nothing counts until you confirm it, but the contents do leave the
              database to be parsed.
            </span>
          </li>
        </ul>
      </Card>

      <Card title="Uploads" sub={`${m.uploads.length} files · re-uploading the same file creates zero duplicate transactions`}>
        {m.isSeedData ? (
        <>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
          These are the §11 reference figures. <b>Sign in to upload your own</b> — uploading is
          disabled here because there is no account to file a statement against, and the storage
          policy namespaces every file by user id.
        </p>
        <div className="tbl-wrap" tabIndex={0}>
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
                      {u.errorMessage ? <span className="sub" style={{ color: 'var(--critical-ink)' }}>{u.errorMessage}</span> : null}
                      <ProcessingLog upload={u} />
                    </td>
                    <td>{accountName(u.bankAccountId)}</td>
                    <td className="tnum">
                      {u.periodStart && u.periodEnd
                        ? `${formatDate(u.periodStart)} – ${formatDate(u.periodEnd)}`
                        : '—'}
                    </td>
                    <td><span className="pill">{u.fileType.toUpperCase()}</span></td>
                    <td className="r tnum">{u.transactionCount ?? '—'}</td>
                    <td><span className={s.cls}><span aria-hidden>{s.icon}</span> {s.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
        ) : (
          <UploadsEditor uploads={m.uploads} accounts={m.accounts} />
        )}
      </Card>

      <Card
        title="Review inbox"
        sub={`${pending.length} transactions pending — these do NOT count in any dashboard figure yet`}
      >
        {pending.length === 0 ? (
          <Empty>Nothing to review. New parsed transactions will appear here.</Empty>
        ) : m.isSeedData ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
              These are the §11 reference figures. <b>Sign in to review your own</b> — confirming
              is disabled here because there is no account whose figures it would move.
            </p>
            <div className="tbl-wrap" tabIndex={0}>
              <table className="wide">
                <thead>
                  <tr>
                    <th>Date</th><th>Description</th><th>Account</th>
                    <th className="r">Amount</th><th>Proposed match</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((t) => {
                    /*
                     * The same proposal the signed-in inbox shows. It is a
                     * derived read with no write behind it, so rendering it on
                     * the read-only reference view is safe — and it is the only
                     * place the e2e suite, which runs signed out, can see the
                     * matcher working end to end.
                     */
                    const sug = t.matchedScheduledPaymentId
                      ? undefined
                      : propose(t, m.payments, m.income);
                    const proposed = sug?.paymentId ?? sug?.incomeStreamId;
                    const payMatch = m.payments.find(
                      (x) => x.id === (t.matchedScheduledPaymentId ?? sug?.paymentId),
                    );
                    const incomeMatch = sug?.incomeStreamId
                      ? m.income.find((x) => x.id === sug.incomeStreamId)
                      : undefined;
                    const matchName = payMatch?.payee ?? incomeMatch?.name;
                    return (
                      <tr key={t.id}>
                        <td className="tnum">{formatDate(t.date)}</td>
                        <td className="payee">{t.description}</td>
                        <td>{accountName(t.bankAccountId)}</td>
                        <td className="r amt tnum">
                          {t.direction === 'debit' ? '−' : '+'}{money(t.amount)}
                        </td>
                        <td>
                          {matchName ? (
                            <span className={proposed ? 'pill' : 'pill ok'}>
                              <span aria-hidden>{proposed ? '?' : '✓'}</span> {matchName}
                              {proposed ? ' (suggested)' : ''}
                            </span>
                          ) : (
                            <span className="pill">No match</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <ReviewInbox
            rows={pending.map((t) => ({
              id: t.id,
              date: t.date,
              description: t.description,
              accountLabel: accountName(t.bankAccountId),
              amount: t.amount,
              direction: t.direction,
              /*
               * A stored category wins; otherwise a keyword rule proposes one
               * (US-32). Same precedence as the payment match, and for the same
               * reason: a fresh proposal must not replace something the parser
               * recorded or the user chose.
               *
               * Derived at render, so editing a rule updates every pending
               * suggestion at once — which is the whole of "rules re-runnable
               * over existing transactions" for anything still pending, with no
               * re-run to invoke because nothing was stored.
               */
              categoryId: t.categoryId ?? categorise(t.description, m.categoryRules),
              isCategoryProposed: !t.categoryId
                && categorise(t.description, m.categoryRules) !== undefined,
              /*
               * A stored match wins; otherwise the matcher proposes one
               * (US-33). Stored first because it is either something the
               * parser recorded or something the user chose, and a fresh
               * proposal must not quietly replace either.
               *
               * The proposal is *not* written to the database. It is a
               * suggestion rendered on a pending row, and it becomes a stored
               * match only when the user confirms — which is what makes
               * "proposes rather than acting silently" structural rather than
               * a promise.
               */
              ...(() => {
                if (t.matchedScheduledPaymentId) {
                  return {
                    matchedScheduledPaymentId: t.matchedScheduledPaymentId,
                    matchLabel: m.payments.find((p) => p.id === t.matchedScheduledPaymentId)?.payee,
                  };
                }
                const p = propose(t, m.payments, m.income);
                if (p.paymentId) {
                  return {
                    matchedScheduledPaymentId: p.paymentId,
                    matchLabel: m.payments.find((x) => x.id === p.paymentId)?.payee,
                    matchReason: p.reason,
                    isProposed: true,
                  };
                }
                /*
                 * The salary half. `proposeIncome()` shipped with #26 and its
                 * result was discarded — there was no column to put it in until
                 * migration 0009.
                 */
                if (p.incomeStreamId) {
                  return {
                    matchedIncomeStreamId: p.incomeStreamId,
                    matchLabel: m.income.find((x) => x.id === p.incomeStreamId)?.name,
                    matchReason: p.reason,
                    isProposed: true,
                  };
                }
                return {};
              })(),
            }))}
            categories={m.budget.map((c) => ({ id: c.id, label: c.name }))}
            /*
             * Derived rows are excluded: a `fee:<uuid>` id has no
             * scheduled_payments row, so selecting one would produce a match
             * the database refuses to store (HAD-81, HAD-76).
             */
            payments={m.payments
              .filter((p) => !p.derivedFrom)
              .map((p) => ({ id: p.id, label: `${p.payee} — ${money(p.amount)}` }))}
            streams={m.income.map((s) => ({ id: s.id, label: `${s.name} — ${money(s.amount)}` }))}
          />
        )}
      </Card>

      <Card title="Transactions ledger" sub={`${confirmed.length} confirmed transactions`}>
        <TransactionsLedger
          rows={confirmed.map((t) => ({
            id: t.id,
            date: t.date,
            description: t.description,
            accountId: t.bankAccountId,
            accountLabel: accountName(t.bankAccountId),
            amount: t.amount,
            direction: t.direction,
            source: t.source,
            categoryId: t.categoryId,
          }))}
          accounts={m.accounts.map((a) => ({ id: a.id, label: `${a.bankName} ··${a.last4}` }))}
          // Only categories that actually appear in the ledger — a filter that
          // can only ever return nothing is worse than no filter.
          categories={m.budget
            .filter((c) => confirmed.some((t) => t.categoryId === c.id))
            .map((c) => ({ id: c.id, label: c.name }))}
        />
      </Card>
    </>
  );
}
