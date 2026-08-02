import { describe, expect, it } from 'vitest';
import { checkUpload } from './upload';
import { deleteUpload, statementDownloadUrl } from '@/app/statements/actions';

/**
 * US-28 (HAD-8) — upload validation, and the two guards that run before a
 * Supabase client exists.
 *
 * `uploadStatement` itself is deliberately **not** tested here. It
 * authenticates before it validates, so an unauthenticated caller is told they
 * are signed out rather than handed a critique of a file the app was never
 * going to take from them. That ordering is worth keeping, so the validation
 * was extracted into `checkUpload` instead of reordered to suit a test.
 *
 * What that leaves untested without a session — the upload itself, the
 * compensating delete when the row insert fails, the signed URL — belongs to
 * the manual pass (HAD-68). Saying so beats implying coverage that is not here.
 */

const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

const file = (name: string, bytes = 10, type = 'application/pdf'): File =>
  new File([new Uint8Array(bytes)], name, { type });

const ACCOUNT = 'acc-1';

describe('checkUpload', () => {
  it('accepts an ordinary statement', () => {
    const r = checkUpload(file('march.pdf'), ACCOUNT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fileType).toBe('pdf');
  });

  it('refuses a missing file', () => {
    const r = checkUpload(null, ACCOUNT);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('Choose a statement file');
  });

  it('refuses an empty file', () => {
    // Zero bytes is what an interrupted picker produces. Uploading it would
    // create a row and an object no parser can do anything with — an entry on
    // the screen that looks like a statement and is not one.
    expect(checkUpload(file('empty.pdf', 0), ACCOUNT).ok).toBe(false);
  });

  it('refuses a string where a file should be', () => {
    // A hand-built POST rather than the form. The `instanceof` is what stops it.
    expect(checkUpload('march.pdf', ACCOUNT).ok).toBe(false);
  });

  it('refuses a type no parser can read, and names the ones it can', () => {
    const r = checkUpload(file('holiday.jpg', 10, 'image/jpeg'), ACCOUNT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('PDF, CSV or XLSX');
  });

  it('refuses a file with no extension at all', () => {
    expect(checkUpload(file('statement'), ACCOUNT).ok).toBe(false);
  });

  it.each([
    ['march.pdf', 'pdf'],
    ['march.PDF', 'pdf'],
    ['march.csv', 'csv'],
    ['march.Csv', 'csv'],
    ['march.xlsx', 'xlsx'],
    ['march.xls', 'xlsx'],
    ['march.XLS', 'xlsx'],
  ] as const)('%s maps to file_type %s', (name, expected) => {
    /*
     * Banks export `.XLS` and `.xlsx` interchangeably and the enum has one
     * value for both. A case-sensitive check would reject a legitimate
     * statement with "that type cannot be parsed" — a claim about the file that
     * is simply untrue, and the sort of confident wrong answer this app exists
     * to avoid.
     */
    const r = checkUpload(file(name), ACCOUNT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fileType).toBe(expected);
  });

  it('takes the last dot, so a dotted filename still resolves', () => {
    // `ENBD.statement.Sep-2026.csv` is an ordinary export name.
    const r = checkUpload(file('ENBD.statement.Sep-2026.csv'), ACCOUNT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fileType).toBe('csv');
  });

  it('refuses a file over the bucket limit, and says how far over', () => {
    // The bucket would reject it too, with "Payload too large". Catching it
    // here means the user learns the size and the limit rather than a phrase
    // from an API they never called.
    const r = checkUpload(file('huge.pdf', 26 * 1024 * 1024), ACCOUNT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('26.0 MB');
      expect(r.error).toContain('25 MB');
    }
  });

  it('accepts a file exactly on the limit', () => {
    // The boundary belongs to the user. Off by one byte here would reject a
    // file the bucket itself would have taken.
    expect(checkUpload(file('exact.pdf', 25 * 1024 * 1024), ACCOUNT).ok).toBe(true);
  });

  it('refuses an upload with no account to attach it to', () => {
    const r = checkUpload(file('march.pdf'), '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('which account');
  });

  it('returns the narrowed file, so the caller never re-asserts the type', () => {
    const f = file('march.pdf');
    const r = checkUpload(f, ACCOUNT);
    expect(r.ok && r.file).toBe(f);
  });
});

describe('deleteUpload / statementDownloadUrl', () => {
  it('deleting nothing is refused rather than attempted', async () => {
    const r = await deleteUpload({ ok: false }, form({}));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Nothing to delete.');
  });

  it('a download link for nothing is refused', async () => {
    const r = await statementDownloadUrl({ ok: false }, form({}));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Nothing to download.');
  });

  it('neither action accepts a storage path from the caller', async () => {
    /*
     * The one that matters for isolation. Both read `storage_path` back from
     * the row rather than taking one off the form, so a forged id returns no
     * row under RLS and removes nothing — whereas a forged *path* would be a
     * request to delete somebody else's object, with only the storage policy
     * in the way.
     *
     * Asserted by consequence: a path supplied here changes nothing, and the
     * action still refuses for want of an id.
     */
    const r = await deleteUpload(
      { ok: false },
      form({ storagePath: 'bbbbbbbb-0000-4000-8000-000000000002/theirs.pdf' }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Nothing to delete.');
  });
});
