'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * App shell: sidebar on desktop, bottom tabs on mobile (NFR-3).
 * The five mobile tabs are the spec's set: Home · Calendar · Budget · Loans · Plan.
 */

const NAV = [
  { href: '/', label: 'Home', icon: '◧', tab: true },
  { href: '/calendar', label: 'Calendar', icon: '▤', tab: true },
  { href: '/schedule', label: 'Schedule', icon: '≡', tab: false },
  { href: '/budget', label: 'Budget', icon: '◑', tab: true },
  { href: '/loans', label: 'Loans', icon: '◈', tab: true },
  { href: '/statements', label: 'Statements', icon: '↥', tab: false },
  { href: '/report', label: 'Report', icon: '▦', tab: false },
  { href: '/plan', label: 'Plan', icon: '✓', tab: true },
  { href: '/profile', label: 'Profile', icon: '◔', tab: false },
  { href: '/settings', label: 'Settings', icon: '⚙', tab: false },
];

function useCurrent() {
  const pathname = usePathname();
  return (href: string) =>
    (href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'page' : undefined;
}

export function Sidebar() {
  const current = useCurrent();
  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark" aria-hidden>₯</div>
        <div className="brand-name">Readiness</div>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={current(n.href)}>
            <span className="ico" aria-hidden>{n.icon}</span> {n.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function BottomTabs() {
  const current = useCurrent();
  return (
    <nav className="bottom-tabs" aria-label="Main">
      {NAV.filter((n) => n.tab).map((n) => (
        <Link key={n.href} href={n.href} aria-current={current(n.href)}>
          <span className="ico" aria-hidden>{n.icon}</span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
