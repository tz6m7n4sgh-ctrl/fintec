import type { Metadata } from 'next';

import { DOORWAYS, DOORWAY_COPY } from '@/lib/onboarding/doorway';
import { chooseDoorway } from './actions';

export const metadata: Metadata = {
  title: 'Where are you right now?',
  description: 'Six questions, then a real figure.',
};

/**
 * The doorway question (P2-2, workstream B1).
 *
 * The home screen has never asked anything before showing something, which is
 * why a stranger's first sight of the app is the reference dataset — real
 * numbers belonging to nobody. Asking one question first is what gives the
 * screen a job.
 *
 * Radios rather than three submit buttons: the choice and the commitment are
 * separate acts, and a person under stress should be able to change their mind
 * before anything happens. It also gives the group a single accessible name,
 * which three unrelated buttons would not have.
 */
export default function StartPage() {
  return (
    <form action={chooseDoorway}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0 }}>
          <h1>Where are you right now?</h1>
          <p className="lede">
            It changes what this app shows you first. You can change it later.
          </p>
        </legend>

        {DOORWAYS.map((d, i) => {
          const copy = DOORWAY_COPY[d];
          const id = `door-${d}`;
          return (
            <label className="door" htmlFor={id} key={d}>
              <input
                type="radio"
                id={id}
                name="doorway"
                value={d}
                defaultChecked={i === 0}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
              />
              <span className="t">{copy.title}</span>
              <span className="d">{copy.body}</span>
            </label>
          );
        })}
      </fieldset>

      <button className="btn primary" type="submit" style={{ width: '100%', marginTop: 8 }}>
        Continue
      </button>

      <p className="privacy-note">
        Six questions, then a real figure. Your answers are stored in your own account and are
        never sent to a model.
      </p>
    </form>
  );
}
