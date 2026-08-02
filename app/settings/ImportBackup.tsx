'use client';

import { useActionState } from 'react';
import { IMPORT_INITIAL, importBackup } from './backup-actions';
import { ERASABLE_TABLES } from '@/lib/settings/erase';

/**
 * Import a backup (US-45).
 *
 * Two screens, because import replaces everything. The first counts what is in
 * the file against what is in the database and writes nothing; the second is
 * the only one that acts. A person restoring a backup after a mistake should be
 * able to see, before they commit, that the file has 1,180 transactions in it
 * and their account currently has 42 — the case where those numbers are the
 * wrong way round is exactly the one worth catching.
 */

/** Human labels, so the confirm table does not read like a schema dump. */
const LABELS: Record<string, string> = {
  profiles: 'Profile',
  notification_prefs: 'Notification settings',
  bank_accounts: 'Bank accounts',
  budget_categories: 'Budget categories',
  income_streams: 'Income streams',
  debts: 'Debts',
  school_fees: 'School fees',
  scheduled_payments: 'Scheduled payments',
  checklist_items: 'Action plan',
  category_rules: 'Categorisation rules',
  statement_uploads: 'Statement uploads',
  transactions: 'Transactions',
  notification_log: 'Reminders sent',
};

export function ImportBackup() {
  const [state, action, pending] = useActionState(importBackup, IMPORT_INITIAL);

  if (state.step === 'done') {
    const total = Object.values(state.restored).reduce((a, b) => a + b, 0);
    return (
      <div role="status">
        <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
          <b>✓ Restored.</b> {state.removed} row{state.removed === 1 ? '' : 's'} replaced with{' '}
          {total} from your backup.
        </p>
        {state.missingFiles > 0 ? (
          /*
            Said here rather than left to be found as a download that fails. The
            export holds figures; the statement PDFs live in storage and do not
            travel with it.
          */
          <p role="alert" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--critical-ink)' }}>
            <b>▲ {state.missingFiles} of {state.uploadRows} statement upload
            {state.uploadRows === 1 ? '' : 's'} has no file behind it.</b> The backup holds your
            figures, not the original PDFs — those stay in storage and do not move between
            accounts. The rows are listed on Statements; the files cannot be opened.
          </p>
        ) : null}
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Reload any screen to see the restored figures.
        </p>
      </div>
    );
  }

  if (state.step === 'preview') {
    const rows = ERASABLE_TABLES.filter(
      (t) => (state.incoming[t] ?? 0) > 0 || (state.existing[t] ?? 0) > 0,
    );
    return (
      <form action={action} className="card" style={{ marginTop: 12 }}>
        <input type="hidden" name="step" value="apply" />
        <input type="hidden" name="payload" value={state.payload} />
        <input type="hidden" name="fileName" value={state.fileName} />

        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          <code>{state.fileName}</code>
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 0 }}>
          {state.exportedAt ? `Exported ${state.exportedAt.slice(0, 10)}. ` : ''}
          Nothing has been changed yet.
        </p>

        {rows.length > 0 ? (
          <div className="tbl-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col" className="r">You have now</th>
                  <th scope="col" className="r">In the backup</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t}>
                    <th scope="row" className="rowhead">{LABELS[t] ?? t}</th>
                    <td className="r tnum">{state.existing[t] ?? 0}</td>
                    <td className="r tnum">{state.incoming[t] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            This backup is empty and you have nothing stored. Importing it would change nothing.
          </p>
        )}

        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--critical-ink)' }}>
          <b>Everything in the left-hand column is deleted first.</b> There is no undo, and the
          import cannot be rolled back partway — if it fails halfway, some of this is restored and
          the rest is gone. Your file stays on your computer either way.
        </p>

        {state.error ? (
          <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
            <b>✕ {state.error}</b>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="import-confirm" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              id="import-confirm"
              name="confirm"
              type="checkbox"
              // No `required`: the server decides, so a disabled-JS submit is
              // checked by the same code as every other one.
              style={{ marginTop: 3 }}
            />
            <span>Replace everything above with this file.</span>
          </label>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            type="submit"
            disabled={pending}
            style={{ borderColor: 'var(--critical-ink)', color: 'var(--critical-ink)' }}
          >
            {pending ? 'Restoring…' : 'Restore from this file'}
          </button>
          {/*
            Its own name, not a second `step` value: the hidden field above is
            already in this form, `FormData.get` returns the first match, and a
            cancel button that silently loses to it would submit the destructive
            branch. Cancelling through the server rather than through local
            state means the file is dropped on both sides.
          */}
          <button className="btn primary" type="submit" name="cancel" value="1" disabled={pending}>
            Cancel — keep my data
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action}>
      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 10, fontSize: 13 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="import-file">Import from JSON</label>
        <input
          id="import-file"
          name="file"
          type="file"
          accept="application/json,.json"
          aria-describedby="import-file-help"
        />
        <span className="help" id="import-file-help">
          A file exported from this app. You will see what it contains before anything changes.
        </span>
      </div>
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 10 }}>
        {pending ? 'Reading…' : 'Read this file'}
      </button>
    </form>
  );
}
