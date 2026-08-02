import { ERASABLE_TABLES, type ErasableTable } from './erase';

/**
 * JSON export and import (US-45 / FR-I3 / BR-9 / NFR-8).
 *
 * The escape hatch. If this app breaks, misprices something, or the user simply
 * wants out, the export is what makes their figures theirs rather than the
 * app's. So it errs toward completeness over tidiness at every choice below.
 */

/**
 * Bumped when the shape changes incompatibly. An import checks it and refuses
 * rather than guessing — a backup half-understood is worse than one rejected,
 * because the user believes it restored.
 */
export const BACKUP_VERSION = 1;

/** Tables in the order an import must write them: parents before children. */
export const IMPORT_ORDER = [...ERASABLE_TABLES].reverse() as ErasableTable[];

/**
 * Ceiling on an uploaded backup.
 *
 * Generous — a decade of transactions is a few megabytes of JSON — but present,
 * because the import screen round-trips the file's text through a hidden field
 * so the confirm step is stateless. Without a cap, a 500 MB file chosen by
 * accident becomes a 500 MB form post.
 *
 * It must stay below `experimental.serverActions.bodySizeLimit` in
 * `next.config.mjs` (12 MB), which is what actually stops the request. Raise
 * this above that and the user gets Next's "Body exceeded" error instead of the
 * sentence below telling them how big their file is.
 */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/**
 * Rows in batches, because a single insert of ten thousand transactions is one
 * request that either works or loses the lot.
 */
export function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface Backup {
  version: number;
  /** When it was taken. Informational; not used to decide anything. */
  exportedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/**
 * Deterministic JSON, so `export → import → export` compares equal.
 *
 * Keys sorted at every level, because object key order in a Postgres row is not
 * something to rely on. Without this the round trip would produce two files
 * with identical content and different bytes, and the acceptance criterion
 * "stable" would be unverifiable.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export type ParseResult =
  | { ok: true; backup: Backup }
  | { ok: false; error: string };

/**
 * Validates a file **completely** before anything is destroyed.
 *
 * Import replaces everything, so a half-valid file must be rejected whole. The
 * alternative — validating as it writes — would leave a user with some tables
 * restored, some emptied, and no way back, which is worse than either
 * succeeding or failing.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON. Nothing has been changed.' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'That file is not a Fintec backup. Nothing has been changed.' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `That backup is version ${String(obj.version ?? 'unknown')}; this app reads version ${BACKUP_VERSION}. Nothing has been changed.`,
    };
  }

  if (!obj.tables || typeof obj.tables !== 'object' || Array.isArray(obj.tables)) {
    return { ok: false, error: 'That backup has no tables in it. Nothing has been changed.' };
  }

  const tables = obj.tables as Record<string, unknown>;
  const known = new Set<string>(ERASABLE_TABLES);

  for (const [name, rows] of Object.entries(tables)) {
    /*
     * An unknown table name is refused rather than skipped. It means the backup
     * came from a different or newer version, and silently ignoring part of a
     * restore is how somebody ends up believing their data came back when some
     * of it did not.
     */
    if (!known.has(name)) {
      return {
        ok: false,
        error: `That backup contains a table this app does not know about (${name}). Nothing has been changed.`,
      };
    }
    if (!Array.isArray(rows)) {
      return { ok: false, error: `The ${name} section of that backup is not a list. Nothing has been changed.` };
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, error: `The ${name} section contains something that is not a row. Nothing has been changed.` };
      }
    }
  }

  return {
    ok: true,
    backup: {
      version: BACKUP_VERSION,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      tables: tables as Backup['tables'],
    },
  };
}

/**
 * Rewrites every row to belong to the importing user.
 *
 * Required, not cosmetic: RLS's `with check` refuses an insert whose `user_id`
 * is not `auth.uid()`, so a backup restored into a different account would fail
 * row by row. Rewriting also means an export can move between accounts, which
 * is the same person's data either way — they hold the file.
 *
 * `storage_path` moves with it. Migration 0006 constrains every
 * `statement_uploads` row to `storage_path like user_id::text || '/%'`, so a
 * row re-owned without rewriting its path is rejected by the database — the
 * whole restore would fail on one table with a check-constraint message that
 * explains nothing. Rewriting the prefix is the only way the insert can
 * succeed.
 *
 * What it does **not** do is move the file. The export is figures, not PDFs;
 * see `backup-actions.ts`, which counts the restored rows whose object is
 * missing and says so rather than presenting a list of undownloadable uploads.
 */
export function reownRows(
  rows: Array<Record<string, unknown>>,
  userId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row, user_id: userId };
    const owner = row.user_id;
    const path = row.storage_path;
    if (typeof owner === 'string' && typeof path === 'string' && path.startsWith(`${owner}/`)) {
      next.storage_path = `${userId}/${path.slice(owner.length + 1)}`;
    }
    return next;
  });
}

/** Rows in a stable order, so two exports of the same data match. */
export function sortRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}
