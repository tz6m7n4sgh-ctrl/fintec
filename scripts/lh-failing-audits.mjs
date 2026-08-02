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

// One run per URL is enough — repeat runs of the same URL fail the same audits.
const byUrl = new Map();
for (const file of reports) {
  const lhr = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const url = lhr.finalDisplayedUrl ?? lhr.finalUrl;
  if (!byUrl.has(url)) byUrl.set(url, lhr);
}

// A diagnostic must never be the thing that fails the job.
process.on('uncaughtException', (err) => {
  console.log(`Could not summarise reports: ${err.message}`);
  process.exit(0);
});

const first = [...byUrl.values()][0];
console.log(`Lighthouse ${first.lighthouseVersion} · ${first.environment?.hostUserAgent ?? 'unknown UA'}\n`);

for (const [url, lhr] of byUrl) {
  console.log(`=== ${url} ===`);
  for (const name of CATEGORIES) {
    const category = lhr.categories[name];
    if (!category) continue;

    const failed = category.auditRefs
      .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
      .filter(({ audit }) => audit && audit.score !== null && audit.score < 1);

    console.log(`  ${name}: ${category.score}`);
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
