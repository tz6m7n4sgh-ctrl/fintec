/**
 * Statement upload validation (US-28 / FR-F1).
 *
 * Pure, and in `lib/` rather than beside the action, for two reasons that
 * happen to agree.
 *
 * The mechanical one: a `'use server'` module may only export async functions,
 * so a synchronous validator cannot live there at all.
 *
 * The one that actually matters: the action authenticates *before* it
 * validates. An unauthenticated caller should be told they are signed out, not
 * handed a detailed critique of a file the app was never going to accept from
 * them. That ordering is worth keeping, and it puts every branch below out of
 * reach of a test without a session. Extracting costs nothing and gives both —
 * the same arrangement `lib/auth/credentials.ts` already uses.
 */

/** Mirrors the bucket's own `file_size_limit`, so the message is ours. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The `public.file_type` enum, and the bucket's `allowed_mime_types`, agree on
 * these three. Keyed by extension because that is what a person recognises —
 * browsers disagree about the MIME type of a CSV often enough that trusting it
 * would reject legitimate files.
 */
const FILE_TYPES: Record<string, 'pdf' | 'csv' | 'xlsx'> = {
  pdf: 'pdf',
  csv: 'csv',
  xlsx: 'xlsx',
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** What a valid submission resolves to, or why it is not one. */
export type UploadCheck =
  | { ok: true; file: File; fileType: 'pdf' | 'csv' | 'xlsx'; ext: string }
  | { ok: false; error: string };

/**
 * Validates a submission without touching Supabase.
 *
 * Pulled out as a pure function for a reason that is worth stating, because the
 * obvious alternative is wrong. The action authenticates *before* it validates
 * — an unauthenticated caller should be told they are signed out, not handed a
 * detailed critique of a file the app was never going to accept from them.
 * Keeping that order means none of this logic is reachable in a test without a
 * session.
 *
 * Reordering to make it testable would trade a security property for coverage.
 * Extracting it costs nothing and gives both.
 */
export function checkUpload(file: unknown, bankAccountId: string): UploadCheck {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a statement file to upload.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit. Export a shorter period from your bank.`,
    };
  }

  const ext = extensionOf(file.name);
  const fileType = FILE_TYPES[ext];
  if (!fileType) {
    return {
      ok: false,
      error: 'Upload a PDF, CSV or XLSX statement. Other formats cannot be parsed.',
    };
  }

  if (!bankAccountId) {
    return {
      ok: false,
      error: 'Say which account this statement is for — transactions are matched per account.',
    };
  }

  // The narrowed `File` travels back so the caller inherits the narrowing
  // rather than re-asserting it — a second `instanceof` would be a second
  // place for the two to disagree about what counts as a file.
  return { ok: true, file, fileType, ext };
}
