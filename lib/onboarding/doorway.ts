/**
 * Which door somebody came in by (decision P2-2).
 *
 * Three entry points were chosen — terminated, expecting it, general planning —
 * and they look incompatible with P2-3's single core answer, *how much am I
 * owed*. Somebody merely planning is owed nothing; nothing has happened to the
 * person expecting a termination.
 *
 * The resolution (§3 of the discovery record) is that the answer is not a
 * number but a **function of a date**: *if your last day were [date], you would
 * be owed AED X*. The doorway then only decides where that date starts and how
 * the screen introduces itself:
 *
 * - already happened — the date is fixed; show the figure
 * - expecting it     — the date is a control; the screen becomes March vs June
 * - planning         — the date is today; *if you walked out now*
 *
 * One engine, one screen, three doorways. So this is presentation state, not a
 * branch in the calculation — which is why it lives in a cookie rather than in
 * the profile row, and why nothing downstream is allowed to compute from it.
 *
 * A cookie is the right size for that today. If the doorway ever earns a place
 * in the answer itself it needs a column and a migration — tracked rather than
 * assumed.
 */

export const DOORWAYS = ['happened', 'coming', 'planning'] as const;

export type Doorway = (typeof DOORWAYS)[number];

export const DOORWAY_COOKIE = 'fintec-doorway';

export interface DoorwayCopy {
  /** The choice, as the user reads it. */
  title: string;
  /** What picking it changes. Written as a consequence, not a description. */
  body: string;
}

export const DOORWAY_COPY: Record<Doorway, DoorwayCopy> = {
  happened: {
    title: "It's already happened",
    body: 'You have a last day. We start from that date and work out what you are owed and what you must not miss.',
  },
  coming: {
    title: "I think it's coming",
    body: 'Nothing is fixed yet. Move the date around and compare — leaving in March against leaving in June.',
  },
  planning: {
    title: "I'm just working things out",
    body: 'Nothing is happening. See where you stand as if you walked out today.',
  },
};

export function isDoorway(value: unknown): value is Doorway {
  return typeof value === 'string' && (DOORWAYS as readonly string[]).includes(value);
}
