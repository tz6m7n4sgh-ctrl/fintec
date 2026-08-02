'use client';

import { useActionState, useMemo, useState } from 'react';
import { shadowedRules, type CategoryRule } from '@/lib/engine/categorise';
import { deleteRule, saveRule, type RuleResult } from './rules-actions';

/**
 * Editable keyword rules (US-32).
 *
 * A rule proposes a category on a pending transaction; the user confirms it.
 * So the risk here is not a wrong figure — it is a rule set nobody can reason
 * about, which is why this screen shows two things a plain CRUD table would
 * not: the ordering that decides ties, and which rules can never fire.
 */

const INITIAL: RuleResult = { ok: false };

const BLANK: CategoryRule = { id: '', keyword: '', categoryId: '', priority: 100 };

function RuleForm({
  rule,
  categories,
  onDone,
}: {
  rule: CategoryRule;
  categories: Array<{ id: string; label: string }>;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveRule, INITIAL);
  const isNew = !rule.id;
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={rule.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a rule' : `Edit — ${rule.keyword}`}
      </h2>

      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="rule-keyword">Keyword</label>
          <input id="rule-keyword" name="keyword" defaultValue={rule.keyword} required />
          <span className="help">
            Matched anywhere in the description, ignoring case. <b>DEWA</b> catches
            &ldquo;DEWA SEP BILL&rdquo;.
          </span>
        </div>
        <div className="field">
          <label htmlFor="rule-category">Sorts into</label>
          <select id="rule-category" name="categoryId" defaultValue={rule.categoryId} required>
            <option value="" disabled>Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-priority">Priority</label>
          <input
            id="rule-priority"
            name="priority"
            type="number"
            min={0}
            step={1}
            defaultValue={rule.priority}
          />
          <span className="help">
            Lower runs first. At equal priority the longer keyword wins, so
            <b> ADCB CAR LOAN</b> beats <b>ADCB</b> without needing a number.
          </span>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add rule' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </form>
  );
}

function DeleteRule({ rule }: { rule: CategoryRule }) {
  const [state, action, pending] = useActionState(deleteRule, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={rule.id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        title={state.error}
        aria-label={`Delete rule ${rule.keyword}`}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function RulesEditor({
  rules,
  categories,
}: {
  rules: CategoryRule[];
  categories: Array<{ id: string; label: string }>;
}) {
  const [editing, setEditing] = useState<CategoryRule | null>(null);

  const label = (id: string) => categories.find((c) => c.id === id)?.label ?? '—';

  /*
   * Shown in the same order the engine evaluates them, so the table *is* the
   * explanation. A list sorted by creation date would leave the user deriving
   * precedence in their head from two columns.
   */
  const ordered = useMemo(
    () =>
      [...rules].sort(
        (a, b) =>
          a.priority - b.priority ||
          b.keyword.length - a.keyword.length ||
          a.keyword.localeCompare(b.keyword),
      ),
    [rules],
  );

  const dead = useMemo(() => new Set(shadowedRules(rules).map((r) => r.id)), [rules]);

  return (
    <>
      {editing ? (
        <RuleForm
          key={editing.id || 'new'}
          rule={editing}
          categories={categories}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add a rule
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Keyword</th><th>Sorts into</th><th className="r">Priority</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => (
              <tr key={r.id}>
                <td className="payee">
                  {r.keyword}
                  {dead.has(r.id) ? (
                    /*
                     * A rule that can never fire is worse than a missing one:
                     * the user believes it is working. Saying so beats leaving
                     * them to discover it by a transaction landing in the wrong
                     * category.
                     */
                    <span className="sub" style={{ color: 'var(--critical-ink)' }}>
                      ▲ Never runs — a broader rule above always wins
                    </span>
                  ) : null}
                </td>
                <td>{label(r.categoryId)}</td>
                <td className="r tnum">{r.priority}</td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(r)}
                    aria-label={`Edit rule ${r.keyword}`}
                  >
                    Edit
                  </button>
                  <DeleteRule rule={r} />
                </td>
              </tr>
            ))}
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No rules yet. Add one and matching transactions will arrive in the review
                  inbox with a category already suggested.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        Rules <b>suggest</b> a category on a new transaction — they never change one you have
        already confirmed. Editing a rule updates every pending suggestion at once, so there is
        nothing to re-run.
      </p>
    </>
  );
}
