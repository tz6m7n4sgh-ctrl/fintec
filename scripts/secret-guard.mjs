#!/usr/bin/env node
/**
 * SEC-3 — stops a credential reaching the repository or the browser bundle.
 *
 * GitHub's own secret scanning already watches this repo and blocks pushes that
 * contain a recognised provider token. This covers the two things it does not:
 *
 *   1. A real value committed into `.env.example`, which is a *template* and is
 *      therefore meant to be committed. Push protection sees a file that is
 *      supposed to exist and a key shaped like the placeholder it replaced.
 *   2. A server-only secret inlined into the client bundle. In Next.js the only
 *      thing separating a server secret from a public one is the
 *      `NEXT_PUBLIC_` prefix, and that boundary is exactly one typo wide.
 *
 * Deliberately not a generic entropy scanner: those produce false positives on
 * hashes and minified code, and a check people learn to ignore is worse than no
 * check.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const problems = [];

// --- 1. No .env file may be tracked by git. -------------------------------
try {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'));
  for (const f of tracked) {
    problems.push(`${f} is tracked by git. Environment files must never be committed.`);
  }
} catch {
  // Not a git checkout (e.g. a tarball build). The other checks still apply.
}

// --- 2. .env.example must hold placeholders, never values. ----------------
// Anything that looks like a real credential rather than an empty or obviously
// fake value. `sb_publishable_...` is exempt because the example uses that
// documented prefix; publishable keys still must not be committed as defaults.
const REAL_LOOKING = [
  /^eyJ[A-Za-z0-9_-]{20,}/, // a JWT — service-role keys are JWTs
  /^sb_secret_/,
  /^postgres(ql)?:\/\/[^\s]*:[^\s]*@/, // a connection string with a password
  /^[A-Za-z0-9_-]{40,}$/, // long opaque token
];

if (existsSync('.env.example')) {
  const lines = readFileSync('.env.example', 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!m) return;
    const [, key, rawValue] = m;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (!value || value.startsWith('sb_publishable_') || /^(x{2,}|<.*>|your[-_]|\.\.\.)/i.test(value)) return;
    if (REAL_LOOKING.some((re) => re.test(value))) {
      problems.push(`.env.example:${i + 1} — ${key} looks like a real credential, not a placeholder.`);
    }
  });
}

// --- 3. No server-only secret may appear in the client bundle. ------------
// Only runs when a build is present; the CI job builds first.
const STATIC_DIR = '.next/static';
const FORBIDDEN = [
  { label: 'a JWT (service-role keys are JWTs)', re: /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\./ },
  { label: 'a Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]+/ },
  { label: 'a Postgres connection string', re: /postgres(ql)?:\/\/[^\s"']*:[^\s"']*@/ },
  { label: 'a PEM private key', re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { label: 'the SUPABASE_SERVICE_ROLE_KEY name', re: /SUPABASE_SERVICE_ROLE_KEY/ },
  { label: 'the VAPID_PRIVATE_KEY name', re: /VAPID_PRIVATE_KEY/ },
];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|css|map|json)$/.test(entry)) {
      const body = readFileSync(path, 'utf8');
      for (const { label, re } of FORBIDDEN) {
        if (re.test(body)) problems.push(`${path} contains ${label}.`);
      }
    }
  }
}

if (existsSync(STATIC_DIR)) {
  walk(STATIC_DIR);
} else {
  console.log('  note: no .next/static — bundle check skipped. Run `npm run build` first.');
}

if (problems.length) {
  console.error('\n  SECRET GUARD FAILED\n');
  for (const p of problems) console.error(`    - ${p}`);
  console.error(
    '\n  A secret in the client bundle is public the moment the page loads.\n' +
      '  Rotate anything that reached this point before removing it.\n',
  );
  process.exit(1);
}

console.log('  Secret guard passed: no credential in the repo template or the client bundle.');
