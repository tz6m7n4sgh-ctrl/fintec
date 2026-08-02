import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERASABLE_TABLES, ERASE_CONFIRMATION } from './erase';

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

/** Every `public.<name>` table the migrations create. */
function tablesInSchema(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

describe('ERASABLE_TABLES', () => {
  it('covers every table the migrations create', () => {
    /*
     * The assertion that outlives this PR. If it fails, a table was added and
     * "delete all data" quietly stopped being true — which is worse than the
     * feature not existing, because the user believes it.
     */
    const schema = tablesInSchema();
    const covered = [...ERASABLE_TABLES].sort();
    expect(covered).toEqual(schema);
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

  it('requires a typed phrase, not a yes', () => {
    // A checkbox or "yes" is too easy to click through for something with no
    // undo. The phrase has to be deliberate to type.
    expect(ERASE_CONFIRMATION.length).toBeGreaterThan(5);
    expect(ERASE_CONFIRMATION).toBe(ERASE_CONFIRMATION.toUpperCase());
  });
});
