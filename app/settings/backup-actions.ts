'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ERASABLE_TABLES } from '@/lib/settings/erase';
import {
  IMPORT_ORDER,
  MAX_BACKUP_BYTES,
  chunk,
  parseBackup,
  reownRows,
} from '@/lib/settings/backup';

/**
 * Import a backup (US-45 / FR-I3 / BR-9 / NFR-8).
 *
 * ## It is two steps, and that is the design
 *
 * Import replaces everything. Choosing a file and having the app immediately
 * delete a year of figures would be the most destructive one-click action in
 * the product — more so than the erase button, which at least announces itself.
 *
 * So the first step only *reads*: it parses the file, counts what is in it, and
 * counts what is currently in the database, and shows both side by side. The
 * user sees "42 transactions here, 1,180 in the file" before anything is at
 * risk. The second step is the only one that writes.
 *
 * The file's text rides between the two steps in a hidden field, so the confirm
 * step carries no server state and cannot act on a file the user never saw
 * counted. It is re-parsed on arrival rather than trusted — it has been through
 * the browser.
 *
 * ## There is no transaction, so the file is the safety net
 *
 * PostgREST gives no way to wrap a delete of thirteen tables and an insert into
 * thirteen more in one transaction. If an insert fails halfway, some tables are
 * restored and some are empty.
 *
 * That is stated rather than hidden, and it is survivable for one reason: the
 * backup file is still on the user's computer, unchanged. Every failure message
 * below says so and names the tables that were written, because "something went
 * wrong" in the middle of a restore is the moment a person most needs to know
 * exactly where they are.
 *
 * ## The export is figures, not PDFs
 *
 * `statement_uploads` rows are restored; the objects they point at are not — a
 * bank statement is binary and lives in the storage bucket. Restoring into the
 * same account is fine, because the files were never deleted. Restoring into a
 * different one leaves rows pointing at objects that do not exist.
 *
 * Rather than let that surface later as a download that 404s, the import counts
 * the restored rows whose file is missing and reports the number. A list of
 * uploads that cannot be opened is exactly the plausible-looking wrong answer
 * this project exists to avoid.
 */

const BUCKET = 'statements';
const INSERT_BATCH = 500;
const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to import a backup.';

export type ImportState =
  /** Nothing chosen yet, or the chosen file was refused. */
  | { step: 'choose'; error?: string }
  /** Parsed and counted. Nothing has been written. */
  | {
      step: 'preview';
      fileName: string;
      /** The file's text, carried back so the confirm step is stateless. */
      payload: string;
      exportedAt: string;
      incoming: Record<string, number>;
      existing: Record<string, number>;
      error?: string;
    }
  /** Written. */
  | {
      step: 'done';
      restored: Record<string, number>;
      removed: number;
      /** Restored upload rows whose file is not in the bucket. */
      missingFiles: number;
      uploadRows: number;
    };

export const IMPORT_INITIAL: ImportState = { step: 'choose' };

async function countEach(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ERASABLE_TABLES) {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
    counts[table] = count ?? 0;
  }
  return counts;
}

export async function importBackup(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  const supabase = await createClient();
  if (!supabase) return { step: 'choose', error: NOT_CONFIGURED };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { step: 'choose', error: SIGNED_OUT };

  // Checked before anything else: cancel means the file is dropped, and it
  // must not be able to fall through to the branch that deletes.
  if (form.get('cancel')) return { step: 'choose' };

  const applying = form.get('step') === 'apply';

  // ---------------------------------------------------------------- step 1
  if (!applying) {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { step: 'choose', error: 'Choose a backup file first. Nothing has been changed.' };
    }
    if (file.size > MAX_BACKUP_BYTES) {
      return {
        step: 'choose',
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${
          MAX_BACKUP_BYTES / 1024 / 1024
        } MB. Nothing has been changed.`,
      };
    }

    const text = await file.text();
    const parsed = parseBackup(text);
    if (!parsed.ok) return { step: 'choose', error: parsed.error };

    const incoming: Record<string, number> = {};
    for (const table of ERASABLE_TABLES) {
      incoming[table] = parsed.backup.tables[table]?.length ?? 0;
    }

    return {
      step: 'preview',
      fileName: file.name,
      payload: text,
      exportedAt: parsed.backup.exportedAt,
      incoming,
      existing: await countEach(supabase),
    };
  }

  // ---------------------------------------------------------------- step 2
  const payload = String(form.get('payload') ?? '');
  const fileName = String(form.get('fileName') ?? 'backup.json');

  /*
   * Re-parsed, not trusted. The text made a round trip through the browser, and
   * validating it again costs a millisecond against the alternative of writing
   * whatever came back.
   */
  const parsed = parseBackup(payload);
  if (!parsed.ok) return { step: 'choose', error: parsed.error };

  const incoming: Record<string, number> = {};
  for (const table of ERASABLE_TABLES) {
    incoming[table] = parsed.backup.tables[table]?.length ?? 0;
  }

  if (form.get('confirm') !== 'on') {
    return {
      step: 'preview',
      fileName,
      payload,
      exportedAt: parsed.backup.exportedAt,
      incoming,
      existing: await countEach(supabase),
      error: 'Tick the box to confirm this replaces everything. Nothing has been changed.',
    };
  }

  // Everything below writes.
  let removed = 0;
  for (const table of ERASABLE_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .not('id', 'is', null)
      .select('id');

    if (error) {
      return {
        step: 'choose',
        error:
          `Stopped while clearing ${table}: ${error.message}. ` +
          `${removed} row(s) had already been deleted and that cannot be undone — but your ` +
          `backup file is untouched on your computer, so you can fix the problem and import again.`,
      };
    }
    removed += data?.length ?? 0;
  }

  const restored: Record<string, number> = {};
  const written: string[] = [];

  for (const table of IMPORT_ORDER) {
    const rows = parsed.backup.tables[table] ?? [];
    if (rows.length === 0) {
      restored[table] = 0;
      continue;
    }

    /*
     * Re-owned, so RLS's `with check` accepts the insert and — for
     * statement_uploads — so migration 0006's storage-path constraint does too.
     * Ids are kept: regenerating them would break every foreign key between the
     * user's own rows, which is most of what the file is.
     */
    const owned = reownRows(rows, user.id);
    let count = 0;

    for (const batch of chunk(owned, INSERT_BATCH)) {
      const { data, error } = await supabase.from(table).insert(batch).select('id');
      if (error) {
        return {
          step: 'choose',
          error:
            `Stopped while restoring ${table}: ${error.message}. ` +
            `${written.length ? `Restored so far: ${written.join(', ')}. ` : 'Nothing was restored. '}` +
            `Everything that was there before is gone, but your backup file is untouched on your ` +
            `computer — fix the problem and import it again.`,
        };
      }
      count += data?.length ?? 0;
    }

    restored[table] = count;
    written.push(`${table} (${count})`);
  }

  /*
   * The rows are back; the PDFs were never in the file. Count the ones whose
   * object is missing so the number is stated here rather than discovered as a
   * download that fails.
   */
  const uploadRows = restored.statement_uploads ?? 0;
  let missingFiles = 0;

  if (uploadRows > 0) {
    const { data: objects } = await supabase.storage.from(BUCKET).list(user.id, { limit: 1000 });
    const present = new Set((objects ?? []).map((o) => `${user.id}/${o.name}`));
    for (const row of reownRows(parsed.backup.tables.statement_uploads ?? [], user.id)) {
      const path = row.storage_path;
      if (typeof path !== 'string' || !present.has(path)) missingFiles += 1;
    }
  }

  revalidatePath('/', 'layout');

  return { step: 'done', restored, removed, missingFiles, uploadRows };
}
