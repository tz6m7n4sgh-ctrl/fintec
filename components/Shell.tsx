'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * App shell: sidebar on desktop, bottom tabs on mobile (NFR-3).
 * The five mobile tabs are the spec's set: Home · Calendar · Budget · Loans · Plan.
 *
 * ## Why every link here sets `prefetch={false}` (HAD-86)
 *
 * Next prefetches a `<Link>` as soon as it enters the viewport. The sidebar
 * puts *all ten* routes in the viewport at once, and every route in this app is
 * dynamic — `ƒ` in the build output, server-rendered on demand — so each
 * prefetch is a full server render, a network round trip, and an RSC payload
 * for the browser to parse.
 *
 * That happens during page load, on the main thread, in exactly the window
 * total-blocking-time measures. On the CI runner it was the difference between
 * a performance score of 0.99 and 0.77 on the same commit, which made the gate
 * pass on its median while failing one run in three.
 *
 * The cost is real and small: the first click on a nav item now fetches rather
 * than reading a cache. That cache was worth little anyway — a dynamic route's
 * prefetch is only held for thirty seconds, so it expires before most people
 * navigate, and it was being paid for on every single page load by every user.
 */

const NAV = [
  { href: '/', label: 'Home', icon: '◧', tab: true },
  { href: '/calendar', label: 'Calendar', icon: '▤', tab: true },
  { href: '/schedule', label: 'Schedule', icon: '≡', tab: false },
  { href: '/budget', label: 'Budget', icon: '◑', tab: true },
  { href: '/loans', label: 'Loans', icon: '◈', tab: true },
  { href: '/statements', label: 'Statements', icon: '↥', tab: false },
  { href: '/report', label: 'Explain', icon: '▦', tab: false },
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
          <Link key={n.href} href={n.href} prefetch={false} aria-current={current(n.href)}>
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
        <Link key={n.href} href={n.href} prefetch={false} aria-current={current(n.href)}>
          <span className="ico" aria-hidden>{n.icon}</span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
