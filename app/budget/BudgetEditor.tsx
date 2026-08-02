'use client';

import { useActionState, useMemo, useState } from 'react';
import type { BudgetCategory } from '@/lib/engine/types';
import { runwayFrom } from '@/lib/engine/uae';
import { aed, money } from '@/lib/format/money';
import { addCategory, deleteCategory, saveBudget, type BudgetResult } from './actions';

/**
 * The editable budget (US-23).
 *
 * The story is "build a survival budget and **watch my runway respond**", and
 * the second half is the part that matters. A budget screen that only saves
 * makes the user submit, wait, navigate, and infer the effect. So the totals
 * and the runway recompute as they type, from the same `runwayFrom` the server
 * uses — not a second copy of the formula that agrees today.
 *
 * The recomputed figure is explicitly labelled unsaved until it is saved. A
 * runway number that looks authoritative but is not yet persisted would be the
 * project's characteristic defect: a plausible figure nobody has checked.
 */

const INITIAL: BudgetResult = { ok: false };

/** Months, or the honest answer when side income covers survival spending. */
function runwayLabel(months: number): string {
  if (!Number.isFinite(months)) return 'Unlimited';
  return `${months.toFixed(1)} months`;
}

const STATUS_LABEL = { good: 'Good', warning: 'Tight', critical: 'Critical' } as const;
const STATUS_ICON = { good: '✓', warning: '▲', critical: '✕' } as const;
const STATUS_INK = {
  good: 'var(--good-ink)',
  warning: 'var(--warning)',
  critical: 'var(--critical-ink)',
} as const;

function AddCategory({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(addCategory, INITIAL);
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Add a category</h2>
      {state.error ? (
        <div role="alert" style={{ fontSize: 13, color: 'var(--critical-ink)', marginBottom: 10 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="nc-name">Name</label>
          <input id="nc-name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="nc-current">Current / month</label>
          <input id="nc-current" name="current" type="number" min={0} step="0.01" defaultValue="" />
        </div>
        <div className="field">
          <label htmlFor="nc-survival">Survival / month</label>
          <input id="nc-survival" name="survival" type="number" min={0} step="0.01" defaultValue="" />
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add category'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteCategory({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteCategory, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        aria-label={`Delete ${name}`}
        title={state.error ?? undefined}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function BudgetEditor({
  categories,
  totalResources,
  monthlySideIncome,
  savedRunwayMonths,
  actualPerMonth,
}: {
  categories: BudgetCategory[];
  totalResources: number;
  monthlySideIncome: number;
  savedRunwayMonths: number;
  /** Average confirmed spend per category per month (US-25). Read-only. */
  actualPerMonth: Record<string, number>;
}) {
  const [state, action, pending] = useActionState(saveBudget, INITIAL);
  const [adding, setAdding] = useState(false);

  // Only editable rows are held in state. Auto rows are rendered from props and
  // never submitted — the server skips them regardless, but not offering an
  // input is the honest UI for a value the user cannot change here.
  const [draft, setDraft] = useState<Record<string, { current: string; survival: string }>>(() =>
    Object.fromEntries(
      categories
        .filter((c) => !c.autoSource)
        .map((c) => [c.id, { current: String(c.currentAmount), survival: String(c.survivalAmount) }]),
    ),
  );

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const { currentTotal, survivalTotal } = useMemo(() => {
    let current = 0;
    let survival = 0;
    for (const c of categories) {
      if (c.autoSource) {
        current += c.currentAmount;
        survival += c.survivalAmount;
      } else {
        const d = draft[c.id];
        current += d ? num(d.current) : c.currentAmount;
        survival += d ? num(d.survival) : c.survivalAmount;
      }
    }
    return { currentTotal: current, survivalTotal: survival };
  }, [categories, draft]);

  // Same function the server calls. If this and the saved figure ever disagree,
  // it is because the draft differs — not because two formulas drifted.
  const live = runwayFrom(totalResources, survivalTotal, monthlySideIncome);

  const dirty = categories.some((c) => {
    if (c.autoSource) return false;
    const d = draft[c.id];
    return d && (num(d.current) !== c.currentAmount || num(d.survival) !== c.survivalAmount);
  });

  const cut = currentTotal - survivalTotal;

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card tile">
          <div className="lbl">Current monthly spend</div>
          <div className="val tnum">{money(currentTotal)}</div>
          <div className="foot">{dirty ? 'Unsaved' : 'Sum of all categories'}</div>
        </div>
        <div className="card tile">
          <div className="lbl">Survival monthly spend</div>
          <div className="val tnum">{money(survivalTotal)}</div>
          <div className="foot">Drives runway and scenarios</div>
        </div>
        <div className="card tile">
          <div className="lbl">Runway at this budget</div>
          <div className="val tnum" style={{ color: STATUS_INK[live.status] }}>
            <span aria-hidden>{STATUS_ICON[live.status]}</span> {runwayLabel(live.runwayMonths)}
          </div>
          {/* Status is never carried by colour alone — icon plus text label. */}
          <div className="foot" aria-live="polite">
            {STATUS_LABEL[live.status]}
            {dirty
              ? ` · unsaved, ${runwayLabel(savedRunwayMonths)} saved`
              : ` · net burn ${aed(live.netMonthlyBurn)}/mo`}
          </div>
        </div>
      </div>

      {adding ? (
        <AddCategory onDone={() => setAdding(false)} />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn" type="button" onClick={() => setAdding(true)}>
            Add a category
          </button>
        </div>
      )}

      <form action={action}>
        {state.error ? (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: 'var(--critical-ink)',
              border: '1px solid color-mix(in oklab, var(--critical) 45%, transparent)',
              borderRadius: 4,
              padding: '8px 10px',
              marginBottom: 12,
            }}
          >
            <b>✕ {state.error}</b>
          </div>
        ) : null}
        {state.ok && !state.error && !dirty ? (
          <div role="status" style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>
            <b>✓ Saved.</b>{' '}
            {state.saved === 0
              ? 'Nothing had changed.'
              : `${state.saved} ${state.saved === 1 ? 'category' : 'categories'} updated — runway recalculated everywhere.`}
          </div>
        ) : null}

        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr>
                <th>Category</th>
                <th className="r">Current</th>
                <th className="r">Survival</th>
                <th className="r">Difference</th>
                <th className="r">Actual / mo</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const d = draft[c.id];
                const cur = c.autoSource ? c.currentAmount : num(d?.current ?? '0');
                const sur = c.autoSource ? c.survivalAmount : num(d?.survival ?? '0');
                const diff = cur - sur;
                return (
                  <tr key={c.id}>
                    <td className="payee">
                      {c.name}
                      {c.autoSource ? <span className="sub">computed — read-only</span> : null}
                    </td>
                    <td className="r">
                      {c.autoSource ? (
                        <span className="tnum">{money(cur)}</span>
                      ) : (
                        <input
                          name={`current-${c.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={d?.current ?? ''}
                          aria-label={`${c.name} — current monthly amount`}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, [c.id]: { ...p[c.id], current: e.target.value } }))
                          }
                          style={{ width: 110, textAlign: 'right' }}
                        />
                      )}
                    </td>
                    <td className="r">
                      {c.autoSource ? (
                        <span className="tnum">{money(sur)}</span>
                      ) : (
                        <input
                          name={`survival-${c.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={d?.survival ?? ''}
                          aria-label={`${c.name} — survival monthly amount`}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, [c.id]: { ...p[c.id], survival: e.target.value } }))
                          }
                          style={{ width: 110, textAlign: 'right' }}
                        />
                      )}
                    </td>
                    <td className="r tnum" style={diff > 0 ? { color: 'var(--good-ink)' } : undefined}>
                      {diff > 0 ? `−${money(diff)}` : '—'}
                    </td>
                    <td className="r tnum" style={{ color: 'var(--ink-2)' }}>
                      {actualPerMonth[c.id] === undefined ? '—' : money(actualPerMonth[c.id])}
                    </td>
                    <td>
                      {c.autoSource === 'debts' ? (
                        <a className="pill" href="/loans">Loans →</a>
                      ) : c.autoSource === 'schoolFees' ? (
                        <a className="pill" href="/loans">School fees →</a>
                      ) : (
                        <span className="pill">Editable</span>
                      )}
                    </td>
                    <td>{c.autoSource ? null : <DeleteCategory id={c.id} name={c.name} />}</td>
                  </tr>
                );
              })}
              <tr className="tot-row">
                <td>Total</td>
                <td className="r tnum">{money(currentTotal)}</td>
                <td className="r tnum">{money(survivalTotal)}</td>
                <td className="r tnum">{cut > 0 ? `−${money(cut)}` : '—'}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" type="submit" disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save budget'}
          </button>
          {dirty ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              Runway above reflects your unsaved edits.
            </span>
          ) : null}
        </div>
      </form>
    </>
  );
}
