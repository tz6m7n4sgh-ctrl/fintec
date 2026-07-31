'use client';

import { useMemo, useState } from 'react';
import { Empty } from '@/components/ui';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';

/**
 * The transactions ledger and its filters (US-35 / FR-F3).
 *
 * This is the only interactive part of the Statements screen, so it is the only
 * part that becomes a client component — the rest of the page stays server
 * rendered. Rows arrive pre-shaped rather than as the raw read model, so the
 * client bundle carries exactly the fields the table shows and nothing else.
 *
 * Filtering runs in memory over already-confirmed rows. When persistence lands
 * this can become a query, but the semantics must not change: pending and
 * duplicate rows are excluded before they ever reach this component, so a
 * mis-parsed statement cannot appear in the ledger by relaxing a filter.
 *
 * Dates compare as `yyyy-mm-dd` strings, which is chronological as well as
 * lexicographic. That is deliberate and matches lib/engine/dates.ts: building a
 * Date here would reintroduce the timezone bug the engine avoids.
 */

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  accountId: string;
  accountLabel: string;
  amount: number;
  direction: 'credit' | 'debit';
  source: 'statement' | 'manual';
  categoryId?: string;
}

export interface FilterOption {
  id: string;
  label: string;
}

export function TransactionsLedger({
  rows,
  accounts,
  categories,
}: {
  rows: LedgerRow[];
  accounts: FilterOption[];
  categories: FilterOption[];
}) {
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [direction, setDirection] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const active = Boolean(account || category || direction || query || from || to);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (account && r.accountId !== account) return false;
        if (category && r.categoryId !== category) return false;
        if (direction && r.direction !== direction) return false;
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        if (q && !r.description.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, account, category, direction, from, to, query]);

  function clear() {
    setAccount('');
    setCategory('');
    setDirection('');
    setQuery('');
    setFrom('');
    setTo('');
  }

  return (
    <>
      <div className="filters">
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          aria-label="Filter by direction"
        >
          <option value="">All directions</option>
          <option value="debit">Debit</option>
          <option value="credit">Credit</option>
        </select>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search description"
          aria-label="Search transaction descriptions"
        />

        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
        />

        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
        />

        {active && (
          <button type="button" className="btn" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      {/* aria-live so a screen reader hears the count change rather than only
          seeing rows vanish. */}
      <div className="legend" aria-live="polite">
        <span className="key">
          Showing {filtered.length} of {rows.length} confirmed transactions
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty>No transactions match these filters.</Empty>
      ) : (
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th className="r">Amount</th>
                <th>Direction</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{formatDate(t.date)}</td>
                  <td className="payee">{t.description}</td>
                  <td>{t.accountLabel}</td>
                  <td className="r amt mono">{money(t.amount)}</td>
                  <td>
                    {t.direction === 'credit' ? (
                      <span className="pill ok">Credit</span>
                    ) : (
                      <span className="pill">Debit</span>
                    )}
                  </td>
                  <td>
                    <span className="pill">{t.source === 'statement' ? 'Statement' : 'Manual'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
