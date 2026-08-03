import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERSION,
  IMPORT_ORDER,
  parseBackup,
  reownRows,
  sortRows,
  stableStringify,
  type Backup,
} from './backup';
import { BACKUP_TABLES, ERASABLE_TABLES } from './erase';

/**
 * US-45. The acceptance criterion doing the work here is the third one —
 * *"round-trip export → import → export is stable"* — because it is the only
 * one that catches a backup which restores *something* rather than the thing
 * that was saved.
 *
 * The other property these defend is that a bad file changes nothing. Import
 * replaces everything, so validation has to be total and up front: a
 * half-applied restore leaves the user with some tables back, some emptied,
 * and no way to tell which.
 */

const backup = (over: Partial<Backup> = {}): Backup => ({
  version: BACKUP_VERSION,
  exportedAt: '2026-08-02T00:00:00.000Z',
  tables: {
    profiles: [{ id: 'p1', user_id: 'u1', basic_salary: 15000 }],
    debts: [{ id: 'd2', user_id: 'u1', name: 'Car' }, { id: 'd1', user_id: 'u1', name: 'Mortgage' }],
  },
  ...over,
});

describe('IMPORT_ORDER', () => {
  it('is the erase order reversed — parents before children', () => {
    /*
     * One list, read both ways. Erase deletes children first so parents do not
     * cascade pointless updates; import writes parents first so a child's
     * foreign key has something to point at. Two hand-maintained lists would be
     * two places to forget a table.
     */
    expect(IMPORT_ORDER).toEqual([...BACKUP_TABLES].reverse());
  });

  it('writes profiles first', () => {
    expect(IMPORT_ORDER[0]).toBe('profiles');
  });

  it('covers every table a backup carries', () => {
    // A table that can be exported and not restored is a backup that quietly
    // loses it.
    expect([...IMPORT_ORDER].sort()).toEqual([...BACKUP_TABLES].sort());
  });

  it('restores nothing that erase would leave behind', () => {
    /*
     * The other direction, and the one that matters now the two lists differ.
     * Every table an import writes must be one erase clears — otherwise a
     * restore could put back a row that "erase everything" has no way to
     * remove, and the user would have no route to a clean account at all.
     */
    const erasable = new Set<string>(ERASABLE_TABLES);
    for (const table of IMPORT_ORDER) expect(erasable.has(table)).toBe(true);
  });
});

describe('stableStringify', () => {
  it('sorts keys, so two exports of one dataset match byte for byte', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('sorts nested keys too', () => {
    expect(stableStringify({ x: { z: 1, y: 2 } })).toBe(stableStringify({ x: { y: 2, z: 1 } }));
  });

  it('leaves array order alone — rows are ordered deliberately elsewhere', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it('preserves nulls rather than dropping them', () => {
    // A null is a value: "no end date" is different from "field absent".
    expect(stableStringify({ end_date: null })).toContain('null');
  });
});

describe('sortRows', () => {
  it('orders by id, so row order cannot drift between exports', () => {
    expect(sortRows([{ id: 'b' }, { id: 'a' }]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const rows = [{ id: 'b' }, { id: 'a' }];
    sortRows(rows);
    expect(rows[0].id).toBe('b');
  });
});

describe('round trip', () => {
  it('export → import → export is byte-stable', () => {
    /*
     * The acceptance criterion, asserted directly. The ids are preserved on
     * import — regenerating them would break every foreign key between the
     * user's own rows, and the second export would not match the first.
     */
    const first = stableStringify({
      ...backup(),
      tables: {
        profiles: sortRows(backup().tables.profiles),
        debts: sortRows(backup().tables.debts),
      },
    });

    const parsed = parseBackup(first);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const second = stableStringify({
      ...parsed.backup,
      tables: {
        profiles: sortRows(parsed.backup.tables.profiles),
        debts: sortRows(parsed.backup.tables.debts),
      },
    });

    expect(second).toBe(first);
  });

  it('re-owning changes only user_id', () => {
    const rows = [{ id: 'd1', user_id: 'old', name: 'Mortgage' }];
    expect(reownRows(rows, 'new')).toEqual([{ id: 'd1', user_id: 'new', name: 'Mortgage' }]);
  });

  it('re-owning does not mutate the original', () => {
    const rows = [{ id: 'd1', user_id: 'old' }];
    reownRows(rows, 'new');
    expect(rows[0].user_id).toBe('old');
  });

  it('re-owning moves storage_path with the owner', () => {
    /*
     * Migration 0006 constrains statement_uploads to
     * `storage_path like user_id::text || '/%'`. Re-own the row and leave the
     * path and the database refuses the insert — the whole restore dies on one
     * table, with a check-constraint message that explains nothing.
     */
    const rows = [{ id: 's1', user_id: 'old', storage_path: 'old/jan.pdf' }];
    expect(reownRows(rows, 'new')[0].storage_path).toBe('new/jan.pdf');
  });

  it('leaves a storage_path that was never the old owner alone', () => {
    // Rewriting it would invent a path, which is worse than failing the check.
    const rows = [{ id: 's1', user_id: 'old', storage_path: 'somebody-else/jan.pdf' }];
    expect(reownRows(rows, 'new')[0].storage_path).toBe('somebody-else/jan.pdf');
  });

  it('re-owning into the same account leaves the path untouched', () => {
    // The common case: restoring your own backup. The file is still in the
    // bucket at exactly this key, and the row must keep pointing at it.
    const rows = [{ id: 's1', user_id: 'u1', storage_path: 'u1/jan.pdf' }];
    expect(reownRows(rows, 'u1')[0].storage_path).toBe('u1/jan.pdf');
  });
});

describe('parseBackup — a bad file must change nothing', () => {
  it('accepts a well-formed backup', () => {
    expect(parseBackup(stableStringify(backup())).ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    const r = parseBackup('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Nothing has been changed');
  });

  it('rejects a JSON array', () => {
    expect(parseBackup('[]').ok).toBe(false);
  });

  it('rejects a different version rather than guessing', () => {
    // A backup half-understood is worse than one refused: the user believes it
    // restored.
    const r = parseBackup(stableStringify(backup({ version: 99 })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('version 99');
  });

  it('rejects a table this app does not know', () => {
    /*
     * Refused, not skipped. An unknown table means the file came from a
     * different version, and silently ignoring part of a restore is how someone
     * ends up believing their data came back when some of it did not.
     */
    const r = parseBackup(stableStringify(backup({ tables: { pets: [] } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('pets');
  });

  it('rejects a table section that is not a list', () => {
    expect(parseBackup('{"version":1,"tables":{"debts":{}}}').ok).toBe(false);
  });

  it('rejects a row that is not an object', () => {
    expect(parseBackup('{"version":1,"tables":{"debts":["nope"]}}').ok).toBe(false);
  });

  it('accepts an empty backup — a new account has nothing to save', () => {
    expect(parseBackup('{"version":1,"exportedAt":"","tables":{}}').ok).toBe(true);
  });

  it('every rejection says nothing was changed', () => {
    // The sentence that matters when someone is looking at a failed restore of
    // their financial records.
    for (const bad of ['nope', '[]', '{"version":99,"tables":{}}', '{"version":1,"tables":{"pets":[]}}']) {
      const r = parseBackup(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('Nothing has been changed');
    }
  });
});
