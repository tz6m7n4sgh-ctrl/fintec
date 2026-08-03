'use client';

import { useActionState, useState } from 'react';

import { aed } from '@/lib/format/money';
import { isBlank, parseFormNumber } from '@/lib/forms/numbers';
import { SIX_FIELDS, type SixField, type SixFieldName } from '@/lib/onboarding/six';
import { saveFigures, type FiguresResult } from '../actions';

const INITIAL: FiguresResult = { ok: false };

/**
 * Six fields, then an answer (P2-5).
 *
 * Two things this form does that the profile form does not:
 *
 * **It says what a blank costs.** No invented defaults, so a field left alone
 * has to explain what omitting it does — including the two leave figures, where
 * blank is explicitly *not* zero. "I took no unpaid leave" and "I have not
 * answered" are different states and only one is safe to compute from.
 *
 * **It says what it read.** `32,000` is how people write salaries, and this
 * project's signature defect was reading that as zero and reporting success.
 * The value we parsed is echoed back whenever we had to interpret anything, so
 * a misread is visible before it becomes a figure rather than after.
 *
 * The validation shown here is the same `readSix` the server action runs — one
 * set of rules, displayed early. The server still re-reads everything; nothing
 * here is trusted.
 */
export function FiguresForm() {
  const [state, action, pending] = useActionState(saveFigures, INITIAL);

  /*
   * Mirrored locally only to decide what to say about each box — the form still
   * posts the real inputs. `touched` exists so six red panels do not greet
   * somebody on an empty form: a cost is worth stating once a person has been
   * to the field, or once they have tried to submit.
   */
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const attempted = Boolean(state.problems) || Boolean(state.error);

  const problemFor = (name: SixFieldName) =>
    state.problems?.find((p) => p.field === name)?.message;

  /*
   * Saved, and deliberately not followed by a figure.
   *
   * Everything on screen elsewhere reads through `getReadModel()`, which stays
   * on the reference dataset until the account has budget rows. Sending someone
   * to one of those screens now would caption somebody else's numbers as
   * theirs. So this says what was saved and what it unlocks, and shows no
   * figure at all rather than a borrowed one.
   */
  if (state.ok) {
    return (
      <div className="saved" role="status">
        <h2>Saved — these six are yours now</h2>
        <p>
          Your gratuity, leave encashment, notice and every deadline are calculated from these
          answers alone. You can change any of them later and every figure moves with them.
        </p>
        <p className="saved-next">
          The screen that puts those figures in front of you is the next thing being built. Until
          it lands, nothing here will show you a number that is not yours — including a worked
          example dressed up as one.
        </p>
        <a className="btn primary" href="/budget">
          Add your monthly spending
        </a>
        <p className="saved-why">
          That is the one thing still missing before the app can say how long your money lasts.
        </p>
      </div>
    );
  }

  return (
    <form action={action} noValidate>
      <div className="six">
        {SIX_FIELDS.map((f) => (
          <Field
            key={f.name}
            field={f}
            value={raw[f.name] ?? ''}
            showCost={(touched[f.name] || attempted) && isBlank(raw[f.name] ?? '')}
            problem={problemFor(f.name)}
            onChange={(v) => setRaw((r) => ({ ...r, [f.name]: v }))}
            onBlur={() => setTouched((t) => ({ ...t, [f.name]: true }))}
          />
        ))}
      </div>

      <div className="six-foot">
        <button className="btn primary" type="submit" disabled={pending} style={{ width: '100%' }}>
          {pending ? 'Working it out…' : 'Show me what I am owed'}
        </button>

        {state.summary ? (
          <p className="remaining" role="status">
            {state.summary}
          </p>
        ) : null}

        {state.error ? (
          <p className="cost" role="alert" style={{ marginTop: 10 }}>
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  field,
  value,
  showCost,
  problem,
  onChange,
  onBlur,
}: {
  field: SixField;
  value: string;
  showCost: boolean;
  problem?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const id = `six-${field.name}`;
  const helpId = `${id}-help`;
  const noteId = `${id}-note`;
  const note = problem ?? (showCost ? field.blankCost : undefined);
  const readAs = interpreted(field, value);

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>

      <input
        id={id}
        name={field.name}
        /*
         * `type="text"` with a decimal keypad for the numbers, matching the
         * profile form: `type="number"` silently discards a value the browser
         * dislikes, and "32,000" is exactly such a value. Losing the raw text
         * is what makes a misread invisible.
         */
        type={field.kind === 'date' ? 'date' : 'text'}
        inputMode={field.kind === 'date' ? undefined : 'decimal'}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-describedby={note ? `${noteId} ${helpId}` : helpId}
        aria-invalid={problem ? true : undefined}
      />

      <div className="help" id={helpId}>
        {field.help}
      </div>

      {readAs ? <p className="read-as">Read as {readAs}.</p> : null}

      {note ? (
        <p className="cost" id={noteId} role={problem ? 'alert' : undefined}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What we made of what was typed — shown only when we had to interpret.
 *
 * `15000` needs no echo; `AED 32,000` does, because that is the input the old
 * code turned into a silent zero. The test is whether the cleaned figure still
 * reads back as what the person typed.
 */
function interpreted(field: SixField, value: string): string | null {
  if (field.kind === 'date' || isBlank(value)) return null;

  const parsed = parseFormNumber(value);
  if (!parsed.ok) return null;
  if (value.trim() === String(parsed.value)) return null;

  return field.kind === 'money'
    ? aed(parsed.value)
    : `${parsed.value} ${parsed.value === 1 ? 'day' : 'days'}`;
}
