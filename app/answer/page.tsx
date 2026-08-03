import { redirect } from 'next/navigation';

/**
 * Retired (HAD-124).
 *
 * This was a hub built with the four-section shell: a runway card and three
 * tiles pointing onward. The Answer section's real screen is `/entitlement` —
 * the figure as a function of a date — and the navigation has pointed there
 * since the shell landed, so this page was reachable only by URL and answered
 * the same question worse. One section, one screen.
 *
 * A redirect rather than a deletion so any bookmark or link that learned this
 * URL during the week it existed still lands somewhere true.
 */
export default function AnswerPage() {
  redirect('/entitlement');
}
