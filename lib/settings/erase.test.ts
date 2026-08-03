import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, ERASABLE_TABLES, ERASE_CONFIRMATION } from './erase';

/**
 * US-46. The test that matters here is not that the list is right today — it is
 * that it *stays* right.
 *
 * "Erase everything" is the one operation whose failure is silent and total: a
 * table added to the schema and forgotten in `ERASABLE_TABLES` leaves that
 * user's data on disk while the screen reports success. Nobody checks a delete
 * that says it worked.
 *
 * So the list is checked against the migrations rather than maintained by hand.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Every migration's SQL, concatenated in order. */
function allMigrations(): string {
  return readdirSync(MIGRATIONS)
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
    .join('\n');
}

/** Every `public.<name>` table the migrations create. */
function tablesInSchema(): string[] {
  const found = new Set<string>();
  for (const m of allMigrations().matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * Tables that hold nothing a user could erase, and the reason each is excused.
 *
 * Not an escape hatch. Every entry is checked below to genuinely have no policy
 * letting a signed-in user touch it — so a table cannot be listed here and then
 * quietly given a delete policy later without this test noticing.
 */
const NOT_USER_ERASABLE: Record<string, string> = {
  webauthn_challenges:
    'RLS enabled with no policies at all: only the passkey Edge Function, under service-role, ever reads or writes it, and every row expires two minutes after it is issued.',
};

describe('ERASABLE_TABLES', () => {
  it('covers every table the migrations create', () => {
    /*
     * The assertion that outlives this PR. If it fails, a table was added and
     * "delete all data" quietly stopped being true — which is worse than the
     * feature not existing, because the user believes it.
     */
    const schema = tablesInSchema().filter((t) => !(t in NOT_USER_ERASABLE));
    const covered = [...ERASABLE_TABLES].sort();
    expect(covered).toEqual(schema);
  });

  it('excuses only tables the user genuinely cannot reach', () => {
    /*
     * The exclusion above is a claim about the schema, so it is checked against
     * the schema. Without this, "not user erasable" would be an assertion-free
     * comment that a later migration could falsify by adding one policy.
     */
    const sql = allMigrations();
    for (const table of Object.keys(NOT_USER_ERASABLE)) {
      expect(sql, `${table} is excused but the migrations never create it`).toContain(
        `create table public.${table}`,
      );
      expect(sql, `${table} is excused but has RLS off`).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(
        sql.match(new RegExp(`create policy [a-z_0-9]+ on public\\.${table}\\b`, 'g')),
        `${table} is excused from erasure but now has a policy, so a user can reach it`,
      ).toBeNull();
    }
  });

  it('names no table the schema does not have', () => {
    // The other direction. A stale name would make the delete error out
    // partway, leaving some tables cleared and some not.
    const schema = new Set(tablesInSchema());
    for (const t of ERASABLE_TABLES) expect(schema.has(t)).toBe(true);
  });

  it('lists profiles last', () => {
    // A half-finished run leaves an app with a profile and no data, which
    // degrades more honestly than data with no profile.
    expect(ERASABLE_TABLES[ERASABLE_TABLES.length - 1]).toBe('profiles');
  });

  it('has no duplicates', () => {
    expect(new Set(ERASABLE_TABLES).size).toBe(ERASABLE_TABLES.length);
  });

  it('erases passkeys, so "everything" includes the ways back in', () => {
    // The one entry on this list that is not data. A user who erases their
    // account and finds a device can still sign into it has not been told the
    // truth by this screen.
    expect(ERASABLE_TABLES).toContain('passkeys');
  });
});

describe('BACKUP_TABLES', () => {
  it('carries everything erasable except credentials', () => {
    /*
     * These were the same list until passkeys existed. A backup is a JSON file
     * a user emails to themselves; its contents should be their money, not a
     * list naming every device that can sign in.
     */
    expect([...BACKUP_TABLES].sort()).toEqual(
      [...ERASABLE_TABLES].filter((t) => t !== 'passkeys').sort(),
    );
  });

  it('excludes passkeys, which cannot be restored anyway', () => {
    /*
     * `credential_id` is unique across the whole table and the credential's
     * user handle names the account it was made for, so an imported passkey
     * either collides or is refused at verification. Exporting one would be
     * offering the user something that cannot come back.
     */
    expect(BACKUP_TABLES).not.toContain('passkeys');
  });

  it('requires a typed phrase, not a yes', () => {
    // A checkbox or "yes" is too easy to click through for something with no
    // undo. The phrase has to be deliberate to type.
    expect(ERASE_CONFIRMATION.length).toBeGreaterThan(5);
    expect(ERASE_CONFIRMATION).toBe(ERASE_CONFIRMATION.toUpperCase());
  });
});
