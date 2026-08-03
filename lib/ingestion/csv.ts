/**
 * Splitting a delimited statement into cells (US-28 / FR-L2).
 *
 * ## Why this is hand-written rather than a dependency
 *
 * A CSV parser is a small, completely specified thing, and every row it gets
 * wrong is money in the wrong place. The libraries are good; the reason not to
 * add one is that this file is ninety lines and reads statements straight out
 * of a bank's export, whereas a dependency is a supply-chain surface on the one
 * code path that touches a user's entire transaction history. HAD-78 spent a
 * PR closing three advisories in packages nobody chose deliberately.
 *
 * It handles what RFC 4180 specifies and what banks actually emit: quoted
 * fields containing the delimiter, doubled quotes inside quotes, embedded
 * newlines, CRLF, and a UTF-8 BOM. It does not handle backslash escapes,
 * because no bank export uses them and accepting them would change the meaning
 * of a description containing a Windows path.
 */

/** The delimiters worth sniffing. Comma first: it wins ties. */
export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Which delimiter this file uses.
 *
 * Counting occurrences over the whole file would be swayed by a description
 * full of commas. Instead each candidate is scored by how *consistent* the
 * column count is across the first several lines, because a real delimiter
 * produces a rectangle and a coincidental one produces noise. Ties go to the
 * candidate that produced more columns, and then to comma.
 */
export function sniffDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  if (sample.length === 0) return ',';

  let best: { delimiter: Delimiter; columns: number } = { delimiter: ',', columns: 0 };

  for (const delimiter of DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length);
    const first = counts[0];
    // A delimiter that is not the delimiter almost never yields the same
    // column count on every line.
    const consistent = counts.every((n) => n === first);
    if (!consistent || first < 2) continue;

    if (first > best.columns) best = { delimiter, columns: first };
  }

  return best.columns >= 2 ? best.delimiter : ',';
}

/** One line, ignoring quoted regions. Used only for sniffing. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

/**
 * One row of the file, and where it was.
 *
 * The line number is carried rather than derived from the row's index, and that
 * is not bookkeeping. Empty rows are dropped, and quoted fields can span
 * several lines, so by the third dropped padding row the index and the line
 * number have diverged. The processing log's whole value is naming a line the
 * user can open the file and look at; a number that is close but wrong is worse
 * than no number, because it sends them to the wrong row and they believe it.
 */
export interface SourceRow {
  cells: string[];
  /** 1-based, counting every physical line including the ones dropped. */
  line: number;
}

/**
 * The whole file to rows of cells.
 *
 * Rows that are entirely empty are dropped — bank exports pad with them, and a
 * blank row carries no transaction. A row with *some* empty cells is kept:
 * that is a real row with a blank debit or credit column, which is exactly how
 * direction is expressed in most two-column formats.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): SourceRow[] {
  // A BOM survives into the first header cell and makes it match nothing.
  const source = text.replace(/^﻿/, '');
  const sep = delimiter ?? sniffDelimiter(source);

  const rows: SourceRow[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  /** The physical line this row started on. */
  let startLine = 1;
  let line = 1;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== '')) rows.push({ cells: row, line: startLine });
    row = [];
    startLine = line;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      // A newline inside a quoted description still advances the file's line
      // count, even though it does not end the row.
      if (char === '\n') line += 1;
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"' && cell.trim() === '') {
      // Only opens a quoted field at the start of one. A quote in the middle of
      // an unquoted value is a character in a description.
      cell = '';
      quoted = true;
      continue;
    }
    if (char === sep) {
      endCell();
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      line += 1;
      endRow();
      continue;
    }
    cell += char;
  }

  // The last row usually has no trailing newline.
  if (cell !== '' || row.length > 0) endRow();

  return rows;
}

/** Every cell in one column, header excluded by the caller. */
export function column(rows: readonly SourceRow[], index: number): string[] {
  return rows.map((row) => row.cells[index] ?? '');
}
