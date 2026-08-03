import { describe, expect, it } from 'vitest';
import { column, parseDelimited, sniffDelimiter } from './csv';

/** Cells only, for the assertions that do not care where a row came from. */
const cellsOf = (text: string, delimiter?: Parameters<typeof parseDelimited>[1]) =>
  parseDelimited(text, delimiter).map((row) => row.cells);

describe('sniffDelimiter', () => {
  it('finds the delimiter that makes the file a rectangle', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('is not fooled by commas inside a semicolon-delimited file', () => {
    /*
     * The naive approach counts occurrences, and this file has more commas than
     * semicolons. Counting would pick comma, split every description in half,
     * and shift every column right of it.
     */
    const text = 'Date;Description;Amount\n03/08/2026;SALARY, AUGUST, PART 1;1,234.56';
    expect(sniffDelimiter(text)).toBe(';');
  });

  it('ignores delimiters inside quotes when scoring', () => {
    const text = 'Date,Description,Amount\n03/08/2026,"CARLTON, DOWNTOWN",250.00';
    expect(sniffDelimiter(text)).toBe(',');
  });

  it('falls back to comma on a single-column file rather than guessing', () => {
    expect(sniffDelimiter('one\ntwo\nthree')).toBe(',');
    expect(sniffDelimiter('')).toBe(',');
  });
});

describe('parseDelimited', () => {
  it('splits a plain file', () => {
    expect(cellsOf('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a delimiter that is inside quotes', () => {
    const rows = cellsOf('Date,Description\n03/08/2026,"CARLTON, DOWNTOWN"');
    expect(rows[1]).toEqual(['03/08/2026', 'CARLTON, DOWNTOWN']);
  });

  it('reads a doubled quote as one literal quote', () => {
    const rows = cellsOf('a\n"He said ""hello"""');
    expect(rows[1]).toEqual(['He said "hello"']);
  });

  it('keeps a newline that is inside quotes', () => {
    // A multi-line description is one transaction. Splitting it produces two
    // rows, one of which has no date and no amount.
    const rows = cellsOf('Description,Amount\n"ATM\nDEIRA",250.00');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['ATM\nDEIRA', '250.00']);
  });

  it('handles CRLF', () => {
    expect(cellsOf('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    /*
     * A BOM survives into the first cell, so the header reads "﻿Date"
     * and matches no known column name. The file then parses as headerless and
     * every column role is wrong.
     */
    const rows = cellsOf('﻿Date,Amount\n03/08/2026,10');
    expect(rows[0][0]).toBe('Date');
  });

  it('drops rows that are entirely empty', () => {
    // Bank exports pad with them.
    expect(cellsOf('a,b\n\n1,2\n,,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a row with some empty cells', () => {
    /*
     * This is how direction is expressed in a two-column format: the debit
     * column is blank on a credit row. Dropping these would drop every credit.
     */
    const rows = cellsOf('Date,Debit,Credit\n03/08/2026,,5000.00');
    expect(rows[1]).toEqual(['03/08/2026', '', '5000.00']);
  });

  it('keeps a quote that appears mid-value', () => {
    // 15" MONITOR is a description, not an unterminated quoted field.
    const rows = cellsOf('Description\nSHARAF DG 15" MONITOR');
    expect(rows[1]).toEqual(['SHARAF DG 15" MONITOR']);
  });

  it('reads the last row when the file has no trailing newline', () => {
    expect(cellsOf('a\n1')).toEqual([['a'], ['1']]);
  });

  it('takes an explicit delimiter over sniffing', () => {
    // A saved parser_config from a previous upload should not be re-sniffed.
    expect(cellsOf('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('source lines', () => {
  it('reports the physical line each row came from, not its index', () => {
    /*
     * The processing log's whole value is naming a line the user can open the
     * file and look at. Dropped padding rows make the index and the line
     * diverge, and a number that is close but wrong sends them to the wrong
     * row — which they then believe.
     */
    const rows = parseDelimited('a,b\n\n\n1,2\n3,4');
    expect(rows.map((r) => r.line)).toEqual([1, 4, 5]);
  });

  it('counts the lines a quoted description spans', () => {
    const rows = parseDelimited('Description,Amount\n"ATM\nDEIRA",250.00\nNEXT,1.00');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe('column', () => {
  it('reads one column, padding short rows rather than dropping them', () => {
    const rows = [
      { cells: ['1', '2'], line: 1 },
      { cells: ['3'], line: 2 },
    ];
    expect(column(rows, 1)).toEqual(['2', '']);
  });
});
