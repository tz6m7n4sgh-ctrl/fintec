'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The four destinations describe what someone came to do, not our data model. */
const NAV = [
  /*
   * `/entitlement` sits inside Answer rather than beside it.
   *
   * B2 added it as an eleventh item while this workstream exists to get to
   * four, so inheriting it would have left the two pulling in opposite
   * directions. It is the answer — the figure, the date that drives it — so
   * Answer is where it belongs and where its `aria-current` should light up.
   */
  { href: '/entitlement', label: 'Answer', icon: '◧', routes: ['/', '/answer', '/entitlement', '/report', '/plan'] },
  { href: '/money', label: 'Money', icon: '◑', routes: ['/money', '/budget', '/calendar', '/schedule', '/loans'] },
  { href: '/documents', label: 'Documents', icon: '↥', routes: ['/documents', '/statements'] },
  { href: '/you', label: 'You', icon: '◔', routes: ['/you', '/profile', '/settings'] },
] as const;

function useCurrent() {
  const pathname = usePathname();
  return (routes: readonly string[]) =>
    routes.some((route) => route === '/' ? pathname === '/' : pathname.startsWith(route))
      ? 'page'
      : undefined;
}

function Navigation({ className }: { className: string }) {
  const current = useCurrent();
  return (
    <nav className={className} aria-label="Main">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={current(item.routes)}
        >
          <span className="ico" aria-hidden>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Desktop top bar. Kept under the old export name to avoid coupling layout to presentation. */
export function Sidebar() {
  return (
    <header className="top-bar">
      <Link className="brand" href="/entitlement" prefetch={false} aria-label="Readiness — Answer">
        <span className="brand-mark" aria-hidden>₯</span>
        <span className="brand-name">Readiness</span>
      </Link>
      <Navigation className="nav" />
    </header>
  );
}

export function BottomTabs() {
  return <Navigation className="bottom-tabs" />;
}
