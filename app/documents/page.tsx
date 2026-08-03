import Link from 'next/link';

import { Badge, Card, Empty, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { formatDate } from '@/lib/engine/dates';

/**
 * Documents (workstream C, frame 26:2).
 *
 * Absorbs Statements. The frame leads with the privacy claim because it is the
 * strongest thing this section has and the code already earns it — a CSV is
 * parsed deterministically on our own server and never sent to a model. The
 * claim sits here, where a person is deciding whether to hand over a bank
 * statement, not in a settings page they will never read.
 *
 * The PDF refusal is a designed state with its reasoning, not an error toast:
 * guessing at a PDF layout produces a ledger that looks right and is not, and
 * a plausible wrong ledger is this project's signature failure.
 */
export default async function DocumentsPage() {
  const m = await getReadModel();

  const pending = m.transactions.filter((t) => t.reviewStatus === 'pending' && !t.isDuplicate);
  const confirmed = m.transactions.filter((t) => t.reviewStatus !== 'pending' && !t.isDuplicate);
  const latest = [...m.uploads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <>
      <PageHead title="Documents" sub="Statements in, transactions confirmed." />

      {/* The privacy position, stated where the decision is made. */}
      <Card title="Your statement never leaves this app">
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '58ch' }}>
          It is read on our own server, line by line, by code you can inspect. It is never sent to
          a model. What the parser did to every row is shown after each import, so a skipped line
          is something you can see rather than something you discover.
        </p>
      </Card>

      {m.uploads.length === 0 ? (
        <Card title="No statements yet" sub="The rest of the app works without one">
          <Empty>
            Uploading a CSV statement lets the app compare your plan with what actually happened —
            confirming payments, spotting the spending your budget missed. Export one from your
            bank&rsquo;s app and it stays yours.
          </Empty>
          <Link prefetch={false} href="/statements" className="btn primary">
            Add a CSV statement
          </Link>
        </Card>
      ) : (
        <>
          {latest ? (
            <Card
              title="Last import"
              sub={`${latest.fileName} · uploaded ${formatDate(latest.createdAt.slice(0, 10))}`}
            >
              <div className="tbl-wrap" tabIndex={0}>
                <table>
                  <tbody>
                    <tr>
                      <th scope="row" className="rowhead">
                        Status
                      </th>
                      <td className="r">
                        {latest.status === 'failed' ? (
                          <Badge tone="critical" icon="✕">
                            Failed — {latest.errorMessage ?? 'see the processing log'}
                          </Badge>
                        ) : latest.status === 'parsed' || latest.status === 'reviewed' ? (
                          <Badge tone="good" icon="✓">
                            {latest.transactionCount ?? 0} rows read
                          </Badge>
                        ) : (
                          <Badge tone="neutral">{latest.status}</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="rowhead">
                        Needs your decision
                      </th>
                      <td
                        className="r tnum"
                        style={pending.length ? { color: 'var(--critical-ink)' } : undefined}
                      >
                        {pending.length}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="rowhead">
                        Confirmed so far
                      </th>
                      <td className="r tnum">{confirmed.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="legend">
                <span className="key">
                  {pending.length > 0 ? (
                    <>
                      <Link prefetch={false} className="banner-link" href="/statements">
                        Review {pending.length}{' '}
                        {pending.length === 1 ? 'transaction' : 'transactions'}
                      </Link>{' '}
                      — nothing reaches your figures until you confirm it.
                    </>
                  ) : (
                    <>
                      Nothing waiting.{' '}
                      <Link prefetch={false} className="banner-link" href="/statements">
                        All statements and transactions
                      </Link>
                    </>
                  )}
                </span>
              </div>
            </Card>
          ) : null}

          <Card title="All statements" sub={`${m.uploads.length} uploaded`}>
            <Link prefetch={false} href="/statements" className="btn primary">
              Statements and transactions
            </Link>
          </Card>
        </>
      )}

      {/* The refusal, with its reasoning, before anyone hits it. */}
      <Card title="PDF statements are refused, on purpose">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', maxWidth: '58ch' }}>
          We do not read PDFs at all. Guessing at a PDF layout produces a ledger that looks right
          and is not — so we refuse rather than try. Export CSV from your bank instead; every bank
          app here can.
        </p>
      </Card>
    </>
  );
}
