'use client';

import { useActionState } from 'react';
import { setChecklistDone, type ChecklistResult } from './actions';

/**
 * One checklist item's done state (HAD-85).
 *
 * A submit button rather than an auto-submitting checkbox. The distinction
 * matters on this screen: these are legal and procedural deadlines, and a
 * control that fires on a stray click would tick off "Claim ILOE — HARD
 * DEADLINE" without the user meaning to. An explicit action is slower and it
 * is the right trade here.
 *
 * The checkbox is a hidden field rather than an input the user touches, so the
 * button label always states what will happen rather than what is true now.
 */
export function ChecklistToggle({
  id,
  done,
  title,
}: {
  id: string;
  done: boolean;
  title: string;
}) {
  const [state, action, pending] = useActionState(setChecklistDone, {
    ok: false,
  } as ChecklistResult);

  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      {/* Absent means unchecked, which is how a checkbox submits — so one
          action serves both directions without a second endpoint. */}
      {done ? null : <input type="hidden" name="done" value="on" />}
      <button
        className={done ? 'btn' : 'btn primary'}
        type="submit"
        disabled={pending}
        title={state.error}
        aria-label={done ? `Mark "${title}" not done` : `Mark "${title}" done`}
      >
        {pending ? '…' : done ? '✓ Done' : 'Mark done'}
      </button>
    </form>
  );
}
