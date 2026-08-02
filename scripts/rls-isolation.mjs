#!/usr/bin/env node
/**
 * Runs supabase/tests/rls-isolation.sql — the SEC-1 cross-tenant isolation
 * proof — against a real Supabase database.
 *
 * Uses psql rather than a Postgres client library, deliberately: this is a
 * security gate, and it should not acquire a dependency of its own. psql is
 * present on GitHub's ubuntu runners and in the dev container.
 *
 * The SQL is wrapped in a transaction that always rolls back, so this is safe
 * to point at production — which is the only place the real policies exist.
 *
 * Connection string: SUPABASE_DB_URL, from
 *   Supabase dashboard -> Project Settings -> Database -> Connection string
 * Use the session pooler or direct connection; the transaction pooler will not
 * work because the test relies on transaction-scoped SET LOCAL.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SQL = 'supabase/tests/rls-isolation.sql';
const url = process.env.SUPABASE_DB_URL;

// A security check that quietly does not run is the failure mode this project
// has hit repeatedly — a plausible green that proves nothing. So skipping is
// loud, and RLS_REQUIRED=1 turns it into a hard failure for CI.
if (!url) {
  const required = process.env.RLS_REQUIRED === '1';
  const message = [
    '',
    '  SEC-1 isolation proof did NOT run — SUPABASE_DB_URL is not set.',
    '',
    '  Nothing here has been verified. Cross-tenant isolation is unproven',
    '  until this passes against a real database.',
    '',
    '    export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"',
    '    npm run test:rls',
    '',
  ].join('\n');

  if (required) {
    console.error(message + '  RLS_REQUIRED=1 is set, so this is a failure.\n');
    process.exit(1);
  }
  console.warn(message);
  process.exit(0);
}

if (!existsSync(SQL)) {
  console.error(`Cannot find ${SQL} — run this from the repository root.`);
  process.exit(1);
}

const psql = spawnSync(
  'psql',
  [url, '-v', 'ON_ERROR_STOP=1', '-X', '-P', 'pager=off', '-f', SQL],
  { stdio: 'inherit' },
);

if (psql.error?.code === 'ENOENT') {
  console.error('\n  psql is not installed. Install postgresql-client and retry.\n');
  process.exit(1);
}

if (psql.status !== 0) {
  console.error(
    '\n  SEC-1 FAILED. Cross-tenant isolation does not hold, or a check could\n' +
      '  not be completed. Read the phase/check_name table above — the failing\n' +
      '  rows name the table and the operation.\n\n' +
      '  Treat this as a data-exposure incident, not a broken test.\n',
  );
  process.exit(psql.status ?? 1);
}

console.log('\n  SEC-1 passed. Isolation holds, and the probe proved it can detect a break.\n');
