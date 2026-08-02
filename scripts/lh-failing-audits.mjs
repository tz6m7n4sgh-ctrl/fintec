/**
 * Prints every Lighthouse audit that did not score a perfect 1, grouped by URL.
 *
 * `lhci assert` reports the *category* score it rejected ("accessibility: 0.96")
 * but not which audit dragged it down, and the category score is a weighted
 * composite — so a bare number is not actionable. This reads the raw reports and
 * names the audits.
 *
 * It exists because the Lighthouse accessibility and best-practices scores came
 * back 1.00 on local Chromium and 0.96 on CI's newer Chrome, which is only
 * diagnosable from the reports themselves.
 *
 * Runs with `if: always()` in CI, so it reports even when the assert step has
 * already failed the job. Never exits non-zero: it is a diagnostic, not a gate.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.lighthouseci';
const CATEGORIES = ['accessibility', 'best-practices', 'performance', 'seo'];

if (!existsSync(DIR)) {
  console.log(`No ${DIR}/ directory — Lighthouse produced no reports.`);
  process.exit(0);
}

const reports = readdirSync(DIR).filter((f) => f.startsWith('lhr-') && f.endsWith('.json'));

if (reports.length === 0) {
  console.log(`No lhr-*.json reports in ${DIR}/.`);
  process.exit(0);
}

/*
 * Every run per URL, not one.
 *
 * This used to keep whichever report the filesystem listed first and discard
 * the rest, on the reasoning that repeat runs of the same URL fail the same
 * audits. They do — but they do not score the same, and since the category
 * gates became **median**-graded that difference is the whole story.
 *
 * The run that exposed it printed `performance: 0.79` beside a passing build.
 * Both were true: 0.79 was one arbitrary run, and the median cleared 0.90. A
 * diagnostic that shows one number next to a gate that measured a different one
 * invites exactly the wrong conclusion, in either direction.
 */
const byUrl = new Map();
for (const file of reports) {
  const lhr = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const url = lhr.finalDisplayedUrl ?? lhr.finalUrl;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(lhr);
}

/** The value lhci actually asserts against. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A diagnostic must never be the thing that fails the job.
process.on('uncaughtException', (err) => {
  console.log(`Could not summarise reports: ${err.message}`);
  process.exit(0);
});

const first = [...byUrl.values()][0][0];
console.log(`Lighthouse ${first.lighthouseVersion} · ${first.environment?.hostUserAgent ?? 'unknown UA'}\n`);

for (const [url, runs] of byUrl) {
  console.log(`=== ${url} · ${runs.length} run(s) ===`);

  /*
   * Audits come from the worst run so nothing is hidden, while the score line
   * shows every run and the median. Reading the two together tells you both
   * what is wrong and whether the gate has any headroom — which a single
   * arbitrary run cannot.
   */
  for (const name of CATEGORIES) {
    if (!runs[0].categories[name]) continue;
    const scores = runs.map((r) => r.categories[name]?.score ?? 0);
    const worst = runs[scores.indexOf(Math.min(...scores))];
    const lhr = worst;
    const category = lhr.categories[name];

    const failed = category.auditRefs
      .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
      .filter(({ audit }) => audit && audit.score !== null && audit.score < 1);

    const med = median(scores);
    const spread = Math.max(...scores) - Math.min(...scores);
    console.log(
      `  ${name}: median ${med.toFixed(2)}  runs [${scores.map((n) => n.toFixed(2)).join(', ')}]` +
        // A wide spread is worth naming: a gate at 0.90 with a 0.11 swing goes
        // red on a bad-luck day with no code change, and that is worth knowing
        // before it happens rather than after.
        (spread >= 0.05 ? `  ← spread ${spread.toFixed(2)}, this gate is flaky` : ''),
    );
    for (const { ref, audit } of failed) {
      // weight 0 audits do not move the score, but still flag a real problem.
      console.log(`    - ${ref.id} (score ${audit.score}, weight ${ref.weight}) — ${audit.title}`);
      // `details.items` is an array for table/opportunity audits but not for
      // every detail type (checklist and node audits differ), so guard it.
      const raw = audit.details?.items;
      const items = Array.isArray(raw) ? raw : [];
      for (const item of items.slice(0, 5)) {
        const selector = item.node?.selector ?? item.source?.url ?? item.url ?? '';
        const explanation = item.node?.explanation ?? item.subItems?.items?.[0]?.signal ?? '';
        if (selector || explanation) console.log(`        ${selector} ${explanation}`.trim());
      }
      if (items.length > 5) console.log(`        …and ${items.length - 5} more`);
    }
  }
  console.log('');
}
