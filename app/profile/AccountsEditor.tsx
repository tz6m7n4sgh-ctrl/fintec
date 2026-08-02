'use client';

import { useActionState, useMemo, useState } from 'react';
import type { BankAccount } from '@/lib/data/seed';
import { money } from '@/lib/format/money';
import { deleteAccount, saveAccount, type AccountResult } from './accounts-actions';

/**
 * Bank accounts (HAD-84).
 *
 * The screen exists because statement upload asked for an account and nothing
 * could create one — every real user hit a dead end, and all of M3 sat behind
 * it.
 *
 * The one thing this screen must be clear about: **an account balance is not
 * savings.** `profiles.cashSavings` is what runway divides into. Someone with
 * 80,000 across three accounts and 80,000 in cash savings has entered one
 * number twice, and a screen that implied these totals feed runway would invite
 * exactly that. So the total is labelled as informational and says what it is
 * not.
 */

const INITIAL: AccountResult = { ok: false };

const BLANK: BankAccount = {
  id: '',
  bankName: '',
  accountLabel: '',
  last4: '',
  currency: 'AED',
  currentBalance: undefined,
  isChequeAccount: false,
};

function AccountForm({ account, onDone }: { account: BankAccount; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveAccount, INITIAL);
  const isNew = !account.id;
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={account.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a bank account' : `Edit — ${account.bankName}`}
      </h2>

      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="acc-bank">Bank</label>
          <input id="acc-bank" name="bankName" defaultValue={account.bankName} required />
        </div>
        <div className="field">
          <label htmlFor="acc-label">Label</label>
          <input id="acc-label" name="accountLabel" defaultValue={account.accountLabel} />
          <span className="help">Optional — &ldquo;Salary account&rdquo;, &ldquo;Joint&rdquo;.</span>
        </div>
        <div className="field">
          <label htmlFor="acc-last4">Last 4 digits</label>
          <input
            id="acc-last4"
            name="last4"
            defaultValue={account.last4}
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
          />
          <span className="help">Four digits, or leave blank.</span>
        </div>
        <div className="field">
          <label htmlFor="acc-balance">Current balance</label>
          <input
            id="acc-balance"
            name="currentBalance"
            type="number"
            step="0.01"
            defaultValue={account.currentBalance ?? ''}
          />
          <span className="help">
            Optional, and <b>not</b> what runway uses — see below.
          </span>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label>
          <input
            name="isChequeAccount"
            type="checkbox"
            defaultChecked={account.isChequeAccount}
          />{' '}
          Cheques are drawn on this account
        </label>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add account' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </form>
  );
}

function DeleteAccount({ account }: { account: BankAccount }) {
  const [state, action, pending] = useActionState(deleteAccount, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={account.id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        title={state.error ?? 'Transactions from this account are kept, unattributed'}
        aria-label={`Delete ${account.bankName} account`}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function AccountsEditor({ accounts }: { accounts: BankAccount[] }) {
  const [editing, setEditing] = useState<BankAccount | null>(null);

  const total = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0),
    [accounts],
  );

  return (
    <>
      {editing ? (
        <AccountForm key={editing.id || 'new'} account={editing} onDone={() => setEditing(null)} />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add a bank account
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Bank</th><th>Label</th><th>Last 4</th>
              <th className="r">Balance</th><th>Cheques</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="payee">{a.bankName}</td>
                <td>{a.accountLabel || '—'}</td>
                <td className="tnum">{a.last4 ? `··${a.last4}` : '—'}</td>
                <td className="r amt tnum">
                  {a.currentBalance === undefined ? '—' : money(a.currentBalance)}
                </td>
                <td>
                  {a.isChequeAccount ? (
                    <span className="pill cheque"><span aria-hidden>◆</span> Yes</span>
                  ) : (
                    <span className="pill">No</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(a)}
                    aria-label={`Edit ${a.bankName} account`}
                  >
                    Edit
                  </button>
                  <DeleteAccount account={a} />
                </td>
              </tr>
            ))}
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No accounts yet. Add one before uploading a statement — a parsed transaction
                  is attributed to the account it came from.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        {accounts.length > 0 ? (
          <>
            <b>{money(total)}</b> across {accounts.length} account
            {accounts.length === 1 ? '' : 's'}, for reference only.{' '}
          </>
        ) : null}
        {/*
          The sentence this screen exists to get right. Two figures that look
          like they should agree, and only one of them feeds runway — see
          HAD-80 for what happens when a fact has two homes.
        */}
        Balances here are <b>not</b> what runway uses. That comes from{' '}
        <b>Cash savings</b> in the Money section above, which you enter separately — so
        recording an account does not change how long your money lasts, and you are not
        entering the same figure twice.
      </p>
    </>
  );
}
