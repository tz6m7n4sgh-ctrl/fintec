'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ERASABLE_TABLES, ERASE_CONFIRMATION } from '@/lib/settings/erase';

/**
 * Erase everything (US-46 / FR-I4 / BR-9 / NFR-8).
 *
 * ## Why this does not delete the account
 *
 * HAD-16 says "every table cascades from `auth.users`, so account deletion
 * removes all rows". That is true of the schema and unavailable to this app:
 * deleting an auth user needs the admin API, which needs the service-role key,
 * which this project deliberately does not have anywhere (SEC-3 found zero
 * uses, and that is one of its strongest properties).
 *
 * So the rows are deleted explicitly, one table at a time, under RLS. The
 * account itself survives — the user can still sign in, and will find an empty
 * app. That is stated on the screen rather than glossed, because "delete
 * everything" that quietly leaves a login behind is the kind of half-truth this
 * project exists to avoid.
 *
 * ## Storage is the part that does not cascade
 *
 * Even if the account *were* deleted, `storage.objects` is keyed by path, not
 * by a foreign key to `auth.users`. Nothing would remove the uploaded bank
 * statements. They would sit in the bucket, owned by a user id that no longer
 * exists, unreachable through the app and entirely present on disk.
 *
 * A "delete everything" that leaves someone's bank statements in a bucket is
 * not a partial success. It is a false claim about the most sensitive thing
 * this app holds.
 *
 * ## So it verifies, and reports what it finds
 *
 * Every delete is followed by a count. If anything survives, the result says
 * so and names the table — rather than returning success because no error was
 * thrown. A delete that silently did nothing looks identical to one that
 * worked, and the user has no way to check.
 */

export interface EraseResult {
  ok: boolean;
  error?: string;
  /** Rows deleted per table, for an honest report. */
  deleted?: Record<string, number>;
  /** Statement files removed from storage. */
  filesDeleted?: number;
  /** Anything still present after the sweep. Empty is the only good answer. */
  survivors?: string[];
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to erase your data.';
const BUCKET = 'statements';

export async function eraseAllData(
  _prev: EraseResult,
  form: FormData,
): Promise<EraseResult> {
  const fail = (error: string): EraseResult => ({ ok: false, error });

  const typed = String(form.get('confirm') ?? '').trim();
  if (typed !== ERASE_CONFIRMATION) {
    return fail(
      `Type ${ERASE_CONFIRMATION} exactly to confirm. Nothing has been deleted.`,
    );
  }

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail(SIGNED_OUT);

  const deleted: Record<string, number> = {};

  /*
   * Storage first, and deliberately.
   *
   * `statement_uploads` holds the object keys. Delete those rows first and the
   * keys are gone — the files would be orphaned in the bucket with nothing left
   * pointing at them, unreachable and undeleteable through the app. The bytes
   * are the most sensitive thing here, so they go before the map to them.
   */
  let filesDeleted = 0;
  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(user.id, { limit: 1000 });

  if (listError) return fail(`Could not list your statement files: ${listError.message}`);

  if (files && files.length > 0) {
    const paths = files.map((f) => `${user.id}/${f.name}`);
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      return fail(
        `Could not delete your statement files: ${removeError.message}. Nothing else was deleted — your data is intact.`,
      );
    }
    filesDeleted = paths.length;
  }

  for (const table of ERASABLE_TABLES) {
    /*
     * `.select()` so the count is what the database actually removed rather
     * than what was asked for. No `.eq('user_id', …)`: RLS scopes this to the
     * signed-in user and SEC-1 proves it does. Adding a filter here would make
     * a broken policy look like a working one — on the one operation where
     * that would be catastrophic in the other direction.
     */
    const { data, error } = await supabase
      .from(table)
      .delete()
      .not('id', 'is', null)
      .select('id');

    if (error) {
      return {
        ok: false,
        error: `Stopped while clearing ${table}: ${error.message}. ${
          Object.keys(deleted).length
        } table(s) were already cleared and that cannot be undone.`,
        deleted,
        filesDeleted,
      };
    }
    deleted[table] = data?.length ?? 0;
  }

  /*
   * The verification pass. A delete that silently affected zero rows returns no
   * error, so "no error" is not evidence of anything — and the user has no way
   * to check for themselves.
   */
  const survivors: string[] = [];
  for (const table of ERASABLE_TABLES) {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) survivors.push(`${table} (${count})`);
  }

  const { data: remainingFiles } = await supabase.storage
    .from(BUCKET)
    .list(user.id, { limit: 1 });
  if (remainingFiles && remainingFiles.length > 0) survivors.push('statement files');

  revalidatePath('/', 'layout');

  return {
    ok: survivors.length === 0,
    error:
      survivors.length > 0
        ? `Some data survived the erase: ${survivors.join(', ')}. This is a bug — do not assume your data is gone.`
        : undefined,
    deleted,
    filesDeleted,
    survivors,
  };
}
