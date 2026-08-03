import type { StatementUpload } from '@/lib/data/seed';

/**
 * What the parser did with this file, line by line (NFR-6 / HAD-8).
 *
 * `statement_uploads.processing_log` has existed since migration 0001 and
 * nothing displayed it until now, which is the criterion HAD-8 was reopened
 * for. It matters because "96 of 100 rows imported" is not a useful thing to
 * be told unless you can find out which four and why — otherwise the honest
 * response is to distrust all hundred.
 *
 * A `<details>` rather than a modal or a state toggle: it works before
 * hydration, it is a disclosure widget every screen reader already announces
 * correctly, and it collapses out of the way for the common case where the
 * parse had nothing surprising to report. Being plain HTML is also why this is
 * its own module rather than part of `UploadsEditor` — the Statements screen
 * renders the uploads table twice, once read-only for the §11 seed and once
 * editable for a signed-in user, and a log that existed in only one of them
 * would be the same rendering saying two different things.
 */
export function ProcessingLog({ upload }: { upload: StatementUpload }) {
  const log = upload.processingLog ?? [];
  if (log.length === 0) return null;

  const skipped = log.filter((e) => e.level === 'skipped').length;
  const problems = log.filter((e) => e.level === 'error').length;

  /*
   * The summary states the thing worth acting on rather than "Details". A
   * closed disclosure labelled "Details" is one nobody opens, and the rows
   * that were skipped are exactly what the reader needs to know exists.
   */
  const summary =
    skipped > 0
      ? `${skipped} row${skipped === 1 ? '' : 's'} skipped — see why`
      : problems > 0
        ? 'What went wrong'
        : 'How this file was read';

  return (
    <details style={{ marginTop: 6 }}>
      <summary
        style={{
          fontSize: 12,
          color: skipped > 0 || problems > 0 ? 'var(--critical-ink)' : 'var(--ink-3)',
          cursor: 'pointer',
        }}
      >
        {summary}
      </summary>
      <ul
        style={{
          margin: '8px 0 0',
          paddingInlineStart: 18,
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--ink-2)',
          whiteSpace: 'normal',
          maxWidth: 460,
        }}
      >
        {log.map((entry, i) => (
          <li
            key={i}
            style={{
              marginBottom: 4,
              color: entry.level === 'error' ? 'var(--critical-ink)' : undefined,
            }}
          >
            {/* The line number is the whole point of a skip entry: it is what
                lets somebody open the file and look at the row. */}
            {entry.line !== undefined ? <b>Line {entry.line}: </b> : null}
            {entry.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
