import {
  UNVERIFIED_BASIS,
  UNVERIFIED_BASIS_SHORT,
  isFullyUnverified,
  unverifiedCount,
} from '@/lib/engine/citations';

/**
 * The unverified-basis panel (workstream A).
 *
 * This sits *beside* the figure, never below the fold — on mobile directly
 * under the number, on desktop level with it at the top of the rail. A caveat a
 * reader has to scroll to find is a caveat the design has decided not to make.
 *
 * Warning-tinted rather than critical: the figure is not wrong, and dressing it
 * in red would teach people to ignore the red that means a missed ILOE
 * deadline. Per NFR-4 the tint never carries the meaning alone — the heading
 * says it in words.
 */
export function UnverifiedBasis() {
  /*
   * Rendered from the rules themselves rather than hardcoded, so that on the day
   * one is sourced this stops appearing on its own. A static paragraph would
   * need somebody to remember to delete it, and nobody remembers to delete a
   * paragraph.
   */
  if (!isFullyUnverified()) return null;

  const { unverified, total } = unverifiedCount();

  return (
    <aside className="basis" aria-labelledby="basis-h">
      <div className="basis-h" id="basis-h">
        Basis not verified
      </div>
      <p>{UNVERIFIED_BASIS}</p>
      {/*
        * The count, because "unverified" on its own invites the reading that one
        * detail is outstanding. Sixteen of sixteen is a different statement, and
        * it is the true one.
        */}
      <p className="basis-count">
        {unverified} of {total} calculation rules have no sourced provision.
      </p>
    </aside>
  );
}

/**
 * The one-line form, for the foot of a single line of working.
 *
 * Same claim, smaller. A breakdown that expands into six rows of arithmetic
 * needs to say whose arithmetic it is without repeating the full paragraph at
 * every level.
 */
export function BasisLine() {
  if (!isFullyUnverified()) return null;
  return <span className="basis-line">{UNVERIFIED_BASIS_SHORT}</span>;
}
