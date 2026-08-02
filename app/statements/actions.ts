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

// ---------------------------------------------------------------------------
// Review inbox (US-31 / HAD-21 / R-2)
// ---------------------------------------------------------------------------

export interface ReviewResult {
  ok: boolean;
  error?: string;
  id?: string;
  /** How many rows a bulk action actually changed. */
  count?: number;
}

/**
 * Confirming is the moment a parsed row starts counting.
 *
 * Until then `monthlyActuals()` skips it — `reviewStatus === 'pending'`
 * continues, verified rather than assumed. That skip is the whole safety net
 * for R-2: an LLM reading a bank statement can misread an amount, and a wrong
 * figure that silently moves a dashboard is the failure this app exists to
 * avoid. Confirmation is a human saying the number is right.
 *
 * So these actions only ever move a row *into* counting, one deliberate act at
 * a time, and the screen says what confirming will do before it is done.
 */

/**
 * `confirmed` means accepted as parsed; `edited` means accepted with changes.
 *
 * The enum has carried three values since 0001 and only two were ever used.
 * The distinction is an audit trail: six months on, "did I check this figure
 * or did the model produce it?" is answerable, and "I corrected this one" is
 * different from "I agreed with it".
 */
function reviewStatusFor(changed: boolean): 'confirmed' | 'edited' {
  return changed ? 'edited' : 'confirmed';
}

/** Confirms one row, optionally with a corrected category or payment match. */
export async function confirmTransaction(
  _prev: ReviewResult,
  form: FormData,
): Promise<ReviewResult> {
  const id = String(form.get('id') ?? '').trim();
  const fail = (error: string): ReviewResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to confirm.');

  const c = await client();
  if (!c.ok) return fail(c.error);
  const { supabase } = c;

  /*
   * Read the row back rather than trusting the form's idea of what was parsed.
   * The page may have been open for an hour; deciding `edited` versus
   * `confirmed` against a stale copy would record that somebody corrected a
   * value they never saw.
   */
  const { data: row, error: readError } = await supabase
    .from('transactions')
    .select('category_id, matched_scheduled_payment_id, matched_income_stream_id, review_status')
    .eq('id', id)
    .maybeSingle();

  if (readError) return fail(explain(readError.message));
  if (!row) return fail('That transaction no longer exists. Reload the page.');
  if (row.review_status !== 'pending') {
    // Not an error worth alarming anyone about — a double submit, or two tabs.
    return { ok: true, id, count: 0 };
  }

  // Empty string is not a uuid; the columns are nullable foreign keys.
  const categoryId = String(form.get('categoryId') ?? '').trim() || null;
  const matchId = String(form.get('matchedScheduledPaymentId') ?? '').trim() || null;
  const incomeId = String(form.get('matchedIncomeStreamId') ?? '').trim() || null;

  /*
   * A row cannot claim both. The database refuses it too
   * (`transactions_one_match_kind`), and the reason is worth stating: a debit
   * cannot arrive from a salary and a credit cannot pay a cheque, so a row
   * with both is a confusion about direction — and the consequence would be a
   * payment marked paid by money coming *in*.
   */
  if (matchId && incomeId) {
    return fail('A transaction is either a payment or income, not both. Reload the page and try again.');
  }

  const changed =
    categoryId !== (row.category_id ?? null) ||
    matchId !== (row.matched_scheduled_payment_id ?? null) ||
    incomeId !== (row.matched_income_stream_id ?? null);

  const { error } = await supabase
    .from('transactions')
    .update({
      category_id: categoryId,
      matched_scheduled_payment_id: matchId,
      matched_income_stream_id: incomeId,
      review_status: reviewStatusFor(changed),
    })
    .eq('id', id);

  if (error) return fail(explain(error.message));

  // Confirming moves actual-spend, the budget comparison and the trend.
  revalidatePath('/', 'layout');
  return { ok: true, id, count: 1 };
}

/**
 * Confirms every pending row as parsed.
 *
 * `.eq('review_status', 'pending')` is not redundant with RLS — it is what
 * makes the action idempotent and what stops a second click re-stamping rows
 * the user already corrected, turning an `edited` back into a `confirmed` and
 * erasing the record that they changed something.
 *
 * No categories or matches are altered here. Bulk confirm means "these are all
 * right as read", which is a different claim from correcting one, and mixing
 * the two would let a fat-fingered bulk action overwrite deliberate edits.
 */
export async function confirmAllPending(
  _prev: ReviewResult,
  _form: FormData,
): Promise<ReviewResult> {
  const fail = (error: string): ReviewResult => ({ ok: false, error });

  const c = await client();
  if (!c.ok) return fail(c.error);

  const { data, error } = await c.supabase
    .from('transactions')
    .update({ review_status: 'confirmed' })
    .eq('review_status', 'pending')
    .eq('is_duplicate', false)
    .select('id');

  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true, count: data?.length ?? 0 };
}

/**
 * Discards a row the parser got wrong.
 *
 * Not in US-31's acceptance criteria, and included anyway for a reason worth
 * stating: without it a misread row has nowhere to go. It would sit pending
 * forever, which is *safe* — pending rows count toward nothing — but it turns
 * the inbox into a list of things you cannot act on, and an inbox nobody can
 * empty is an inbox nobody reads. R-2's safety net only works if the screen
 * stays worth opening.
 *
 * A delete rather than a status, because the row is wrong: keeping it would
 * occupy its `dedupe_hash` and stop the corrected version being inserted on a
 * re-parse.
 */
export async function discardTransaction(
  _prev: ReviewResult,
  form: FormData,
): Promise<ReviewResult> {
  const id = String(form.get('id') ?? '').trim();
  const fail = (error: string): ReviewResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to discard.');

  const c = await client();
  if (!c.ok) return fail(c.error);

  /*
   * Only a pending row. A confirmed transaction is part of the user's actual
   * spending history and deleting it from this screen would quietly change a
   * figure they had already agreed to.
   */
  const { error } = await c.supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('review_status', 'pending');

  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true, id, count: 1 };
}
