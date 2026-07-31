import { Card, PageHead } from '@/components/ui';
import { daysUntil, formatDate } from '@/lib/engine/dates';
import { getReadModel, resolveDeadline } from '@/lib/data/store';

export default async function PlanPage() {
  const m = await getReadModel();
  const s = m.score;

  const bandTone = s.band === 'STRONG' ? 'good' : s.band === 'MODERATE' ? 'warning' : 'critical';
  const bandIcon = s.band === 'STRONG' ? '✓' : s.band === 'MODERATE' ? '▲' : '✕';

  return (
    <>
      <PageHead
        title="Readiness & action plan"
        sub="A score you can act on, and the deadlines that come with it"
      />

      <Card>
        <div className="hero">
          <div>
            <div className="card-sub">Readiness score</div>
            <div className="hero-num mono">
              {s.total}<small> / {s.max}</small>
            </div>
            <div style={{ marginTop: 10 }}>
              <span className={`status st-${bandTone}`}>
                <span aria-hidden>{bandIcon}</span> {s.band}
              </span>
            </div>
          </div>
          <div className="hero-meta">
            Scored on financial position only — runway, ILOE cover, settlement size and debt
            burden. Completing the checklist below does not inflate the score; it keeps you
            out of trouble.
            <br />
            <span style={{ color: 'var(--ink-3)' }}>
              STRONG ≥ 14 · MODERATE 9–13 · AT RISK &lt; 9
            </span>
          </div>
        </div>
      </Card>

      <Card title="Score breakdown" sub="Every point is attributable">
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr><th>Criterion</th><th className="r">Score</th><th>Why</th></tr>
            </thead>
            <tbody>
              {s.criteria.map((c) => (
                <tr key={c.key}>
                  <td className="payee">{c.label}</td>
                  <td className="r mono amt">{c.score} / {c.max}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{c.detail}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <td>Total</td>
                <td className="r mono">{s.total} / {s.max}</td>
                <td>{s.band}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Action plan" sub="Deadlines are computed from your last working day">
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr><th>Done</th><th>Action</th><th>When</th><th className="r">Countdown</th></tr>
            </thead>
            <tbody>
              {m.checklist.map((item) => {
                const dl = resolveDeadline(item.deadlineKey, m);
                const days = dl.date ? daysUntil(dl.date) : null;
                const hard = item.deadlineKey === 'iloeDeadline';
                return (
                  <tr key={item.id}>
                    <td><input type="checkbox" defaultChecked={item.done} disabled aria-label={item.title} /></td>
                    <td className="payee">
                      {item.title}
                      <span className="sub">{item.detail}</span>
                    </td>
                    <td>
                      {hard
                        ? <span className="pill cheque"><span aria-hidden>✕</span> {dl.label}</span>
                        : <span className="pill">{dl.label}</span>}
                      {dl.date ? <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>{formatDate(dl.date)}</div> : null}
                    </td>
                    <td className="r mono">
                      {days === null ? '—' : days >= 0 ? `${days} days` : `${Math.abs(days)} days ago`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            MOHRE <a href="tel:600590000">600 590 000</a> · ILOE <a href="tel:600599555">600 599 555</a>
          </span>
        </div>
      </Card>
    </>
  );
}
