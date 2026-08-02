import Link from 'next/link';
import type { ReactNode } from 'react';

import { aed, money } from '@/lib/format/money';
import type { RunwayStatus } from '@/lib/engine/types';

/**
 * Shared presentational pieces.
 *
 * The one rule these encode: a status is never communicated by colour alone —
 * every status badge ships an icon and a text label (NFR-4 / BR-1).
 */

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Card({
  title,
  sub,
  children,
  right,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <div>
            <div className="card-title">{title}</div>
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const STATUS_META: Record<RunwayStatus, { icon: string; label: string; cls: string }> = {
  good: { icon: '✓', label: 'Good — 6 months or more', cls: 'st-good' },
  warning: { icon: '▲', label: 'Warning — 3 to 6 months', cls: 'st-warning' },
  critical: { icon: '✕', label: 'Critical — under 3 months', cls: 'st-critical' },
};

export function RunwayStatusBadge({ status }: { status: RunwayStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`status ${m.cls}`}>
      <span aria-hidden>{m.icon}</span> {m.label}
    </span>
  );
}

export function Badge({
  tone,
  icon,
  children,
}: {
  tone: 'good' | 'warning' | 'serious' | 'critical' | 'neutral';
  icon?: string;
  children: ReactNode;
}) {
  const cls = tone === 'neutral' ? 'pill' : `status st-${tone}`;
  return (
    <span className={cls}>
      {icon ? <span aria-hidden>{icon}</span> : null} {children}
    </span>
  );
}

/**
 * A stat tile. `href` is required by design: every AED figure must navigate to
 * the screen where its inputs live (NFR-5 / BR-11).
 */
export function StatTile({
  label,
  value,
  foot,
  href,
}: {
  label: string;
  value: string;
  foot: string;
  href: string;
}) {
  return (
    <Link className="card tile" href={href}>
      <div className="lbl">{label}</div>
      <div className="val tnum">{value}</div>
      <div className="foot">
        <span className="arrow" aria-hidden>→</span> {foot}
      </div>
    </Link>
  );
}

export function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const negative = value < 0;
  const text = signed && negative ? `−${money(Math.abs(value))}` : money(value);
  return (
    <span className="tnum" style={negative ? { color: 'var(--critical-ink)' } : undefined}>
      {text}
    </span>
  );
}

export function AedTotal({ value }: { value: number }) {
  return <span className="tnum">{aed(value)}</span>;
}

export function LegalFooter() {
  return (
    <footer className="legal">
      General information, not legal or financial advice. UAE rules current as of July 2026 —
      verify with MOHRE (<a href="tel:600590000">600 590 000</a>) or a licensed advisor.
      Free-zone contracts may differ.
    </footer>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '14px 0' }}>{children}</p>
  );
}

/**
 * Scenario verdict. Centralised so the dashboard and the termination report can
 * never disagree about the same number — a shortfall is a shortfall, and
 * "tight" means less than one further month of burn remains.
 */
export function scenarioTone(
  remaining: number,
  netMonthlyBurn: number,
): { tone: 'good' | 'warning' | 'critical'; icon: string; label: string } {
  if (remaining < 0) return { tone: 'critical', icon: '✕', label: 'Shortfall' };
  if (netMonthlyBurn > 0 && remaining < netMonthlyBurn) {
    return { tone: 'warning', icon: '▲', label: 'Tight' };
  }
  return { tone: 'good', icon: '✓', label: 'OK' };
}

export function ScenarioBadge({
  remaining,
  netMonthlyBurn,
}: {
  remaining: number;
  netMonthlyBurn: number;
}) {
  const s = scenarioTone(remaining, netMonthlyBurn);
  return (
    <span className={`status st-${s.tone}`}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </span>
  );
}
