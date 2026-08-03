'use client';

import { useActionState, useState } from 'react';
import type { BankAccount, StatementUpload } from '@/lib/data/seed';
import { formatDate } from '@/lib/engine/dates';
import { ProcessingLog } from './ProcessingLog';
import {
  deleteUpload,
  statementDownloadUrl,
  uploadStatement,
  type LinkResult,
  type UploadResult,
} from './actions';

/**
 * Upload, download and delete statements (US-28).
 *
 * The warning about LLM parsing is repeated on the form itself rather than left
 * to the explainer card above. Someone who has read that card once will not
 * read it again, and this is the control that actually sends a bank statement
 * out of the database — the consent belongs next to the button, not three
 * screens up.
 */

const INITIAL: UploadResult = { ok: false };
const INITIAL_LINK: LinkResult = { ok: false };

const STATUS_PILL: Record<string, { cls: string; icon: string; label: string }> = {
  uploaded: { cls: 'pill', icon: '↥', label: 'Uploaded' },
  queued: { cls: 'pill', icon: '◌', label: 'Queued' },
  processing: { cls: 'pill', icon: '◐', label: 'Processing' },
  parsed: { cls: 'pill ok', icon: '✓', label: 'Parsed' },
  failed: { cls: 'pill cheque', icon: '✕', label: 'Failed' },
  reviewed: { cls: 'pill ok', icon: '✓', label: 'Reviewed' },
};

function UploadForm({ accounts }: { accounts: BankAccount[] }) {
  const [state, action, pending] = useActionState(uploadStatement, INITIAL);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Upload a statement</h2>

      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      {/*
        A stored file whose parse said something is not a failed upload, and
        conflating the two would tell somebody their PDF did not upload when it
        did. `role="status"` rather than `alert` for the same reason.
      */}
      {state.notice ? (
        <div role="status" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
          {state.notice}
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="up-account">Bank account</label>
          <select id="up-account" name="bankAccountId" required defaultValue="">
            <option value="" disabled>Choose an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} ··{a.last4}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="up-file">Statement file</label>
          <input
            id="up-file"
            name="file"
            type="file"
            required
            accept=".pdf,.csv,.xls,.xlsx"
          />
        </div>
      </div>

      <p className="help" style={{ marginTop: 10 }}>
        CSV, up to 25 MB. The file goes to a private bucket namespaced to your user id —
        never a public URL. A <b>CSV is read here, by code, and never sent anywhere</b>: the
        columns are matched by name and the dates and amounts are read deterministically.
        Nothing it extracts moves a dashboard figure until you confirm it.
      </p>
      <p className="help" style={{ marginTop: 8 }}>
        <b>PDF and XLSX are stored but not yet read.</b> A PDF needs layout reconstruction or
        a language model, and a PDF read as plain text produces a scatter of numbers that
        would import as convincing, wrong transactions. Export CSV from your bank instead —
        every UAE bank offers it.
      </p>

      <div style={{ marginTop: 14 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Uploading…' : 'Upload statement'}
        </button>
      </div>
    </form>
  );
}

function DeleteUpload({ upload }: { upload: StatementUpload }) {
  const [state, action, pending] = useActionState(deleteUpload, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={upload.id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        title={state.error}
        aria-label={`Delete ${upload.fileName}`}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

function DownloadUpload({ upload }: { upload: StatementUpload }) {
  const [state, action, pending] = useActionState(statementDownloadUrl, INITIAL_LINK);

  /*
   * The link is rendered rather than followed automatically. A signed URL
   * arriving as a side effect of a form submit would be a download the user did
   * not visibly ask for a second time, and pop-up blockers treat a programmatic
   * `window.open` after an await as exactly that.
   */
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={upload.id} />
      {state.ok && state.url ? (
        <a className="btn" href={state.url} download={upload.fileName}>
          Save file
        </a>
      ) : (
        <button
          className="btn"
          type="submit"
          disabled={pending}
          title={state.error}
          aria-label={`Get a download link for ${upload.fileName}`}
        >
          {pending ? '…' : 'Download'}
        </button>
      )}
    </form>
  );
}

export function UploadsEditor({
  uploads,
  accounts,
}: {
  uploads: StatementUpload[];
  accounts: BankAccount[];
}) {
  const [showForm, setShowForm] = useState(false);
  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.bankName} ··${a.last4}` : '—';
  };

  if (accounts.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <a href="/profile/">Add a bank account</a> before uploading. A statement is matched
        to transactions per account, so uploading one without an account to attach it to
        would leave the rows nowhere to land.
      </p>
    );
  }

  return (
    <>
      {showForm ? (
        <UploadForm accounts={accounts} />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setShowForm(true)}>
            Upload a statement
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>File</th><th>Account</th><th>Period</th><th>Type</th>
              <th className="r">Rows</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u) => {
              const s = STATUS_PILL[u.status];
              return (
                <tr key={u.id}>
                  <td className="payee">
                    {u.fileName}
                    {u.errorMessage ? (
                      <span className="sub" style={{ color: 'var(--critical-ink)' }}>
                        {u.errorMessage}
                      </span>
                    ) : null}
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
                  <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                    <DownloadUpload upload={u} />
                    <DeleteUpload upload={u} />
                  </td>
                </tr>
              );
            })}
            {uploads.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No statements uploaded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
