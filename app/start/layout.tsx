import type { ReactNode } from 'react';

/**
 * The first run has no navigation.
 *
 * "The first screen is somebody else's finances and ten navigation items" is
 * the problem this route exists to solve, so showing the same ten items around
 * it would be self-defeating. `.first-run` suppresses the shell in
 * `globals.css`.
 *
 * That suppression is presentational and temporary. The shell is mounted in the
 * root layout today; workstream C moves it into a nested layout, at which point
 * `/start` simply sits outside it and the CSS goes.
 */
export default function StartLayout({ children }: { children: ReactNode }) {
  return <div className="first-run">{children}</div>;
}
