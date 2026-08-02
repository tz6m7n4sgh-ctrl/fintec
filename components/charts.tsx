/**
 * Charts, rendered as inline SVG on the server.
 *
 * Rules enforced here (NFR-4):
 *  - one y-axis, always; never a dual-axis chart
 *  - a single-series chart carries no legend — the title names it
 *  - key points are labelled directly; we never label every point
 *  - status colours are reserved for status
 */

import { money, moneySigned } from '@/lib/format/money';
import type { MonthlyActual, Projection } from '@/lib/engine/projection';

/**
 * Picks a round gridline interval targeting ~6 gridlines. Aiming for 6 rather
 * than 4 keeps the domain snug around the data — with too few candidate steps
 * the axis rounds out to a range much wider than the values, wasting the plot.
 */
function niceStep(range: number): number {
  const raw = range / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 1.5, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
}

/** Projected cash balance with lump-sum overlay and below-zero shading (FR-A3). */
export function ProjectionChart({ projection }: { projection: Projection }) {
  const W = 730;
  const H = 244;
  const X0 = 58;
  const X1 = 706;
  const Y0 = 18;
  const Y1 = 206;

  const values = [projection.start, ...projection.points.map((p) => p.balance)];
  const rawMax = Math.max(...values, 0);
  const rawMin = Math.min(...values, 0);
  const step = niceStep(rawMax - rawMin);
  const vMax = Math.ceil(rawMax / step) * step;
  const vMin = Math.floor(rawMin / step) * step;

  const n = values.length;
  const sx = (i: number) => X0 + ((X1 - X0) * i) / (n - 1);
  const sy = (v: number) => Y0 + ((Y1 - Y0) * (vMax - v)) / (vMax - vMin || 1);

  const pts = values.map((v, i) => [sx(i), sy(v)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const zeroY = sy(0);

  // Ticks: only the grid values inside the domain.
  const ticks: number[] = [];
  for (let v = vMin; v <= vMax + 1e-9; v += step) ticks.push(Math.round(v));

  // Below-zero polygon, starting at the exact crossing point so the shading
  // begins where the balance actually turns negative.
  let negPoly = '';
  const firstNeg = values.findIndex((v) => v < 0);
  if (firstNeg > 0) {
    const v0 = values[firstNeg - 1];
    const v1 = values[firstNeg];
    const t = v0 / (v0 - v1);
    const xc = sx(firstNeg - 1) + (sx(firstNeg) - sx(firstNeg - 1)) * t;
    const tail = pts.slice(firstNeg).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
    negPoly = [`${xc.toFixed(1)},${zeroY.toFixed(1)}`, ...tail, `${X1},${zeroY.toFixed(1)}`].join(' ');
  }

  const lumpPoints = projection.points
    .map((p, i) => ({ p, i: i + 1 }))
    .filter(({ p }) => p.lumpSum > 0);

  // X labels every third month, so ticks never collide.
  const xLabels = projection.points
    .map((p, i) => ({ label: p.label, i: i + 1 }))
    .filter((_, i) => i % 3 === 2);

  const last = projection.points[projection.points.length - 1];

  const describe =
    `Projected balance starts at AED ${money(projection.start)} and ` +
    (projection.zeroCrossingLabel
      ? `falls below zero in ${projection.zeroCrossingLabel}, ending at AED ${moneySigned(last.balance)}.`
      : `stays positive, ending at AED ${moneySigned(last.balance)}.`) +
    (lumpPoints.length
      ? ` Cheque lump sums: ${lumpPoints.map(({ p }) => `AED ${money(p.lumpSum)} in ${p.label}`).join(', ')}.`
      : '');

  return (
    <>
      <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={describe}>
        {ticks.map((v) => (
          <g key={v}>
            {v !== 0 && <line className="gl" x1={X0} y1={sy(v)} x2={X1} y2={sy(v)} />}
            <text className="tick-v" x={X0 - 8} y={sy(v) + 3.5}>
              {v === 0 ? '0' : `${v < 0 ? '−' : ''}${Math.abs(v) / 1000}k`}
            </text>
          </g>
        ))}

        {negPoly && <polygon points={negPoly} fill="var(--critical)" opacity="0.13" />}

        <line className="zl" x1={X0} y1={zeroY} x2={X1} y2={zeroY} />
        {negPoly && (
          <text
            className="lbl-sm"
            x={X1}
            y={zeroY - 5}
            textAnchor="end"
            style={{ fill: 'var(--critical-ink)', fontWeight: 650 }}
          >
            below zero
          </text>
        )}

        <polyline
          fill="none"
          stroke="var(--s1)"
          strokeWidth="2"
          strokeLinejoin="round"
          points={line}
        />

        {/* Start point, labelled directly. */}
        <circle cx={pts[0][0]} cy={pts[0][1]} r="4.5" fill="var(--s1)" stroke="var(--surface-1)" strokeWidth="2" />
        <text className="lbl-pt" x={pts[0][0] + 6} y={pts[0][1] - 7}>
          {money(projection.start)} start
        </text>

        {/* Lump sums: marked in the categorical orange, below the line. */}
        {lumpPoints.map(({ p, i }) => (
          <g key={p.month}>
            <circle cx={pts[i][0]} cy={pts[i][1]} r="4.5" fill="var(--s2)" stroke="var(--surface-1)" strokeWidth="2" />
            <text className="lbl-pt" x={pts[i][0]} y={pts[i][1] + 17} textAnchor="middle" style={{ fill: 'var(--s2)' }}>
              −{money(p.lumpSum)}
            </text>
            <text className="lbl-sm" x={pts[i][0]} y={pts[i][1] + 29} textAnchor="middle">
              {p.lumpSumPayees[0]?.split(' ')[0] ?? 'cheque'}
            </text>
          </g>
        ))}

        {/* Zero crossing. */}
        {projection.zeroCrossingMonth !== null && (
          <text
            className="lbl-pt"
            x={sx(projection.zeroCrossingMonth) + 8}
            y={zeroY + 42}
            style={{ fill: 'var(--critical-ink)' }}
          >
            runs out {projection.zeroCrossingLabel}
          </text>
        )}

        {/* End point. */}
        <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="4.5" fill="var(--s1)" stroke="var(--surface-1)" strokeWidth="2" />
        <text className="lbl-pt" x={pts[n - 1][0] - 6} y={pts[n - 1][1] + 15} textAnchor="end">
          {moneySigned(last.balance)}
        </text>

        <line x1={X0} y1={Y1 + 15} x2={X1} y2={Y1 + 15} stroke="var(--axis)" strokeWidth="1" />
        {xLabels.map(({ label, i }) => (
          <text key={label} className="tick" x={sx(i)} y={Y1 + 28} textAnchor="middle">
            {label}
          </text>
        ))}

        {/*
          Hover layer. Only a handful of points are labelled directly — labelling
          all nineteen would be unreadable — so every month gets an invisible hit
          band carrying a native tooltip. This uses SVG <title> rather than a
          scripted tooltip so it costs no client JavaScript and is exposed to
          assistive technology as the element's accessible name.
        */}
        {projection.points.map((p, idx) => {
          const i = idx + 1;
          const band = (X1 - X0) / (n - 1);
          // One concatenated string, not several JSX children: adjacent text
          // nodes make React emit comment separators, which are illegal inside
          // <title> and fail hydration.
          const tip =
            `${p.label}: ${moneySigned(p.balance)}` +
            (p.lumpSum > 0
              ? ` — includes a cheque lump sum of ${money(p.lumpSum)} (${p.lumpSumPayees.join(', ')})`
              : '') +
            (p.belowZero ? ' — below zero' : '');
          return (
            <rect
              key={`hit-${p.month}`}
              x={sx(i) - band / 2}
              y={Y0}
              width={band}
              height={Y1 - Y0}
              fill="none"
              pointerEvents="all"
            >
              <title>{tip}</title>
            </rect>
          );
        })}
      </svg>
      <div className="legend">
        <span className="key"><span className="sw" style={{ background: 'var(--s1)' }} /> Projected balance</span>
        {lumpPoints.length > 0 && (
          <span className="key"><span className="sw" style={{ background: 'var(--s2)' }} /> Cheque lump sum (not in budget)</span>
        )}
        {negPoly && (
          <span className="key"><span className="sw" style={{ background: 'var(--critical)', opacity: 0.35 }} /> Below zero</span>
        )}
      </div>
    </>
  );
}

/** Single-series actual spend trend — no legend by design (NFR-4). */
export function ActualSpendChart({ data }: { data: MonthlyActual[] }) {
  if (data.length < 2) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
        Not enough confirmed transactions yet — confirm a statement in the review inbox to see
        this trend.
      </p>
    );
  }

  const W = 330;
  const X0 = 40;
  const X1 = 300;
  const Y0 = 12;
  const Y1 = 86;

  const vals = data.map((d) => d.spend);
  const rawMax = Math.max(...vals);
  const rawMin = Math.min(...vals);
  const pad = (rawMax - rawMin) * 0.25 || rawMax * 0.1 || 1;
  const vMax = rawMax + pad;
  const vMin = Math.max(0, rawMin - pad);

  const sx = (i: number) => X0 + ((X1 - X0) * i) / (data.length - 1);
  const sy = (v: number) => Y0 + ((Y1 - Y0) * (vMax - v)) / (vMax - vMin || 1);
  const line = data.map((d, i) => `${sx(i).toFixed(1)},${sy(d.spend).toFixed(1)}`).join(' ');

  const first = data[0];
  const lastPoint = data[data.length - 1];

  return (
    <svg
      className="plot"
      viewBox={`0 0 ${W} 116`}
      role="img"
      aria-label={`Actual monthly spending from AED ${money(first.spend)} in ${first.label} to AED ${money(lastPoint.spend)} in ${lastPoint.label}.`}
    >
      {[vMax, (vMax + vMin) / 2, vMin].map((v, i) => (
        <g key={i}>
          <line className="gl" x1={X0} y1={sy(v)} x2={X1} y2={sy(v)} />
          <text className="tick-v" x={X0 - 6} y={sy(v) + 3.5}>{(v / 1000).toFixed(1)}k</text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" points={line} />

      {/* Per-month hover detail: only the endpoints are labelled directly. */}
      {data.map((d, i) => (
        <circle key={`hit-${d.month}`} cx={sx(i)} cy={sy(d.spend)} r="9" fill="none" pointerEvents="all">
          <title>{`${d.label}: spent ${money(d.spend)}${d.income ? `, received ${money(d.income)}` : ''}`}</title>
        </circle>
      ))}

      <circle cx={sx(0)} cy={sy(first.spend)} r="4" fill="var(--s1)" stroke="var(--surface-1)" strokeWidth="2" />
      <text className="lbl-sm" x={sx(0)} y={sy(first.spend) + 16}>{money(first.spend)}</text>
      <circle cx={sx(data.length - 1)} cy={sy(lastPoint.spend)} r="4" fill="var(--s1)" stroke="var(--surface-1)" strokeWidth="2" />
      <text className="lbl-pt" x={sx(data.length - 1)} y={sy(lastPoint.spend) - 9} textAnchor="end">
        {money(lastPoint.spend)}
      </text>
      <line x1={X0} y1={98} x2={X1} y2={98} stroke="var(--axis)" />
      {data.map((d, i) =>
        i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2) ? (
          <text
            key={d.month}
            className="tick"
            x={sx(i)}
            y={111}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          >
            {d.label.split(' ')[0]}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Current vs survival bars — two series, so a legend is required. */
export function BudgetBars({
  rows,
  currentTotal,
  survivalTotal,
}: {
  rows: Array<{ id: string; name: string; currentAmount: number; survivalAmount: number; auto: boolean }>;
  currentTotal: number;
  survivalTotal: number;
}) {
  const max = Math.max(...rows.map((r) => Math.max(r.currentAmount, r.survivalAmount)), 1);
  const sorted = [...rows].sort((a, b) => b.currentAmount - a.currentAmount);

  return (
    <>
      <div className="bars">
        {sorted.map((r) => (
          <div className="bar-row" key={r.id}>
            <div className="bar-name" title={r.name}>
              {r.name}
              {r.auto ? <span className="auto">auto</span> : null}
            </div>
            <div className="track">
              <div className="bar cur" style={{ width: `${(r.currentAmount / max) * 100}%` }} />
              <div className="bar sur" style={{ width: `${(r.survivalAmount / max) * 100}%` }} />
            </div>
            <div className="bar-val tnum">
              {money(r.currentAmount)} → {money(r.survivalAmount)}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span className="key"><span className="sw" style={{ background: 'var(--s1)' }} /> Current — {money(currentTotal)}/mo</span>
        <span className="key"><span className="sw" style={{ background: 'var(--s3)' }} /> Survival — {money(survivalTotal)}/mo</span>
      </div>
    </>
  );
}
