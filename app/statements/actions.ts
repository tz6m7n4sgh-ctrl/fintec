'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { MAX_UPLOAD_BYTES, checkUpload } from '@/lib/statements/upload';

/**
 * Statement upload to private storage (US-28 / FR-F1 / NFR-1).
 *
 * Two invariants shape everything here, and both are about what a *partial*
 * failure leaves behind.
 *
 * **1. A row always implies an object.** The bytes go up first and the
 * `statement_uploads` row is written last; on delete the row goes first and the
 * object second. So the two orderings are mirror images of one rule: the row is
 * the last thing created and the first thing destroyed.
 *
 * The alternative fails worse. A row whose object is missing is an upload the
 * screen lists, offers to download, and cannot produce — a lie on screen, and
 * this app's whole problem is plausible wrong answers. An object with no row is
 * invisible, costs a few kilobytes, and tells nobody anything false. When the
 * row insert fails after a successful upload, the object is deleted to close
 * even that gap.
 *
 * **2. No user-supplied text ever reaches the storage key.** The key is
 * `<uid>/<uuid>.<ext>` — the uid because the storage policy matches on the
 * first path segment (HAD-76), the uuid because two uploads of `statement.pdf`
 * would otherwise collide, and neither component comes from the filename. The
 * name the user recognises lives in `file_name`, where it is data rather than a
 * path.
 */

export interface UploadResult {
  ok: boolean;
  error?: string;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to upload.';
const BUCKET = 'statements';

async function client() {
  const supabase = await createClient();
  if (!supabase) return { ok: false as const, error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false as const, error: SIGNED_OUT };
  return { ok: true as const, supabase, user: auth.user };
}

/** Turns a storage or constraint failure into a sentence. */
function explain(message: string): string {
  if (message.includes('statement_uploads_path_is_object_key')) {
    // Unreachable by construction — the key is built from user.id here. If it
    // ever fires, the key stopped being namespaced and every later read of this
    // file would be refused by the storage policy (HAD-76).
    return 'That file could not be filed against your account. Reload the page and try again.';
  }
  if (message.includes('The resource already exists') || message.includes('Duplicate')) {
    return 'A file with that name already exists in storage. Try again — a fresh name is generated each time.';
  }
  if (message.includes('exceeded the maximum allowed size') || message.includes('Payload too large')) {
    return `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`;
  }
  if (message.includes('mime type') || message.includes('not supported')) {
    return 'That file type is not accepted. Upload a PDF, CSV or XLSX statement.';
  }
  if (message.includes('violates foreign key constraint')) {
    return 'That bank account no longer exists. Reload the page and pick again.';
  }
  return message;
}

/**
 * Uploads one statement and records it.
 *
 * Created with status `uploaded`, not `queued`. The two are different claims:
 * `uploaded` means the bytes are here, `queued` means a parser has accepted the
 * file. Nothing queues anything yet — that is HAD-9's scheduled Cowork job — so
 * writing `queued` would be a status the system cannot back up.
 */
export async function uploadStatement(
  _prev: UploadResult,
  form: FormData,
): Promise<UploadResult> {
  const fail = (error: string): UploadResult => ({ ok: false, error });

  const c = await client();
  if (!c.ok) return fail(c.error);
  const { supabase, user } = c;

  const bankAccountId = String(form.get('bankAccountId') ?? '').trim();

  // Auth above, validation here — deliberately in that order. See `checkUpload`.
  const check = checkUpload(form.get('file'), bankAccountId);
  if (!check.ok) return fail(check.error);
  const { file, fileType, ext } = check;

  /*
   * `<uid>/<uuid>.<ext>`. The uid must be the first segment or the storage
   * policy refuses every operation on the object, including the owner's
   * (HAD-76). The uuid makes re-uploading the same filename safe.
   */
  const objectKey = `${user.id}/${randomUUID()}.${ext}`;

  const uploaded = await supabase.storage.from(BUCKET).upload(objectKey, file, {
    contentType: file.type || undefined,
    // Never overwrite. A collision here would mean a uuid repeated, which is
    // worth failing loudly over rather than silently replacing somebody's file.
    upsert: false,
  });
  if (uploaded.error) return fail(explain(uploaded.error.message));

  const { error } = await supabase.from('statement_uploads').insert({
    user_id: user.id,
    bank_account_id: bankAccountId,
    file_name: file.name,
    storage_path: objectKey,
    file_type: fileType,
    status: 'uploaded',
  });

  if (error) {
    // Invariant 1: no row, so no object. Best-effort — if this cleanup also
    // fails the result is an orphaned file, which is the harmless direction.
    await supabase.storage.from(BUCKET).remove([objectKey]);
    return fail(explain(error.message));
  }

  revalidatePath('/statements');
  return { ok: true };
}

/**
 * Deletes an upload and its file.
 *
 * Row first, object second — the mirror of upload. If the object removal fails
 * the file is orphaned in the bucket, which nobody can see and nothing reads.
 * The reverse order would leave a row the screen renders as a downloadable
 * statement that no longer exists.
 */
export async function deleteUpload(_prev: UploadResult, form: FormData): Promise<UploadResult> {
  const id = String(form.get('id') ?? '').trim();
  const fail = (error: string): UploadResult => ({ ok: false, error });
  if (!id) return fail('Nothing to delete.');

  const c = await client();
  if (!c.ok) return fail(c.error);
  const { supabase } = c;

  /*
   * Read the key back rather than trusting one submitted with the form. RLS
   * scopes this select to the signed-in user, so a forged id returns no row and
   * deletes nothing — whereas a forged *path* would be a request to remove
   * somebody else's object, and the storage policy would be the only thing
   * standing in the way. Two defences are better than one, and this one costs a
   * round trip.
   */
  const { data: row, error: readError } = await supabase
    .from('statement_uploads')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (readError) return fail(explain(readError.message));
  if (!row) return fail('That upload no longer exists. Reload the page.');

  const { error } = await supabase.from('statement_uploads').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  await supabase.storage.from(BUCKET).remove([row.storage_path]);

  revalidatePath('/statements');
  return { ok: true };
}

export interface LinkResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * A short-lived signed URL for one file.
 *
 * The bucket is private and must stay that way (NFR-1), so there is no public
 * URL to link to. Sixty seconds is enough to start a download and short enough
 * that a URL copied out of the address bar is useless by the time it is pasted
 * anywhere.
 */
export async function statementDownloadUrl(
  _prev: LinkResult,
  form: FormData,
): Promise<LinkResult> {
  const id = String(form.get('id') ?? '').trim();
  const fail = (error: string): LinkResult => ({ ok: false, error });
  if (!id) return fail('Nothing to download.');

  const c = await client();
  if (!c.ok) return fail(c.error);
  const { supabase } = c;

  const { data: row } = await supabase
    .from('statement_uploads')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (!row) return fail('That upload no longer exists. Reload the page.');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 60);

  if (error || !data) return fail(explain(error?.message ?? 'Could not produce a download link.'));
  return { ok: true, url: data.signedUrl };
}
