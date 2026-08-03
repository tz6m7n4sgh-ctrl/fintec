import { createClient } from '@/lib/supabase/server';
import { BACKUP_TABLES } from '@/lib/settings/erase';
import { BACKUP_VERSION, sortRows, stableStringify } from '@/lib/settings/backup';

/**
 * Export everything as JSON (US-45 / FR-I3 / NFR-8).
 *
 * ## Why a route handler rather than a server action
 *
 * This is a file download, and a route handler is the only thing here that can
 * actually produce one: the browser gets `Content-Disposition: attachment`,
 * names the file itself, and streams it straight to disk. A server action would
 * have to return the whole backup as a string into the React tree, where the
 * client would rebuild it as a Blob — the same bytes, held twice in memory, and
 * broken entirely with JavaScript disabled.
 *
 * A plain `<a href>` also means the escape hatch keeps working on the day the
 * app's JavaScript is what is broken. That is the scenario this feature exists
 * for.
 *
 * ## Why GET is safe here
 *
 * A cross-origin page can cause this request but cannot read the response — the
 * same-origin policy stops `fetch`, and `<script src>` chokes on JSON that is
 * served as an attachment. There is nothing to forge: it changes nothing.
 */

export const dynamic = 'force-dynamic';

const plain = (message: string, status: number) =>
  new Response(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return plain('Supabase is not configured for this deployment.', 503);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return plain('You are signed out. Sign in again to export your data.', 401);

  const tables: Record<string, Array<Record<string, unknown>>> = {};

  for (const table of BACKUP_TABLES) {
    /*
     * `select('*')`, not a column list.
     *
     * A named list is a second place to remember a column, and the failure mode
     * is the one this project keeps finding: a migration adds a field, nobody
     * updates the export, and the backup silently stops containing it. The user
     * would never see a gap — they would see a file, restore it, and find a
     * number missing. `*` cannot drift.
     *
     * No `.eq('user_id', …)`. RLS is the boundary and SEC-1 proves it; a
     * redundant filter here would make a broken policy look like a working one
     * on the one operation that reads every table at once.
     */
    const { data, error } = await supabase.from(table).select('*');

    if (error) {
      // Refused whole. A backup missing one table looks exactly like a complete
      // one, and the user finds out when they restore it.
      return plain(
        `Could not export ${table}: ${error.message}. No file was produced — nothing partial, ` +
          `because a backup with a table missing is indistinguishable from a complete one until ` +
          `you need it.`,
        500,
      );
    }

    tables[table] = sortRows((data ?? []) as Array<Record<string, unknown>>);
  }

  const now = new Date();

  /*
   * `exportedAt` is metadata about the act of exporting, not about the data, so
   * two exports of one unchanged dataset differ in this field and nowhere else.
   * The round-trip stability the acceptance criterion asks for is a property of
   * `tables`, and that is what the tests compare.
   */
  const body = stableStringify({
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    tables,
  });

  const day = now.toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="fintec-backup-${day}.json"`,
      // Someone's whole financial position. It does not belong in a proxy or a
      // browser's back/forward cache.
      'cache-control': 'no-store, private',
    },
  });
}
