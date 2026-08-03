import { describe, expect, it } from 'vitest';
import {
  detectDateOrder,
  detectDecimalStyle,
  isRealDate,
  parseAmount,
  parseDate,
} from './values';

/**
 * The two ways a statement parser ruins a ledger without looking broken.
 *
 * Both failures here produce output that passes every downstream check: the
 * rows are present, the totals add up, the screen renders. They are just about
 * different money, on different days. That is the whole reason these functions
 * refuse rather than guess.
 */

describe('detectDateOrder', () => {
  it('settles on day-first when a day above 12 appears first', () => {
    const result = detectDateOrder(['03/08/2026', '17/08/2026', '01/09/2026']);
    expect(result.order).toBe('dmy');
  });

  it('settles on month-first when a day above 12 appears second', () => {
    const result = detectDateOrder(['08/03/2026', '08/17/2026', '09/01/2026']);
    expect(result.order).toBe('mdy');
  });

  it('refuses a column where every date fits both readings', () => {
    /*
     * The one that matters. A statement covering only the first twelve days of
     * a month is an ordinary thing for a monthly statement to be, and there is
     * no evidence in it either way. Guessing the local convention is a
     * coin-flip that moves every row by months when it loses — and nothing
     * about the result would look wrong.
     */
    const result = detectDateOrder(['03/08/2026', '05/08/2026', '11/08/2026']);
    expect(result.order).toBeNull();
    expect(result).toMatchObject({ ambiguous: true });
    expect(result.reason).toMatch(/3 August or 8 March/);
  });

  it('refuses a column that contains evidence for both orders', () => {
    // Not ambiguity — a contradiction. This column is not one format, and any
    // single reading is wrong for some of its rows.
    const result = detectDateOrder(['17/08/2026', '08/17/2026']);
    expect(result.order).toBeNull();
    expect(result).toMatchObject({ ambiguous: false });
  });

  it('needs no inference for ISO dates', () => {
    expect(detectDateOrder(['2026-08-03', '2026-08-05']).order).toBe('ymd');
  });

  it('needs no inference when the month is spelled', () => {
    expect(detectDateOrder(['03 Aug 2026', '05 Aug 2026']).order).toBe('ymd');
    expect(detectDateOrder(['Aug 3, 2026', 'Aug 5, 2026']).order).toBe('ymd');
  });

  it('still reads evidence from a mixed ISO and numeric column', () => {
    // A file with a posting date in ISO and a value date in dd/mm. The numeric
    // evidence is what settles it; the ISO values neither help nor confuse.
    expect(detectDateOrder(['2026-08-03', '17/08/2026']).order).toBe('dmy');
  });

  it('ignores blanks rather than treating them as unparseable', () => {
    expect(detectDateOrder(['', '  ', '17/08/2026']).order).toBe('dmy');
  });

  it('says so when the column is not dates at all', () => {
    const result = detectDateOrder(['Salary', 'ATM withdrawal']);
    expect(result.order).toBeNull();
    expect(result.reason).toMatch(/looks like a date/);
  });
});

describe('parseDate', () => {
  it('reads the same digits differently for each order', () => {
    expect(parseDate('03/08/2026', 'dmy')).toBe('2026-08-03');
    expect(parseDate('03/08/2026', 'mdy')).toBe('2026-03-08');
  });

  it('reads ISO regardless of the order it is handed', () => {
    // The order argument only ever disambiguates day-versus-month. A date that
    // names its own order must not be re-interpreted by it.
    expect(parseDate('2026-08-03', 'dmy')).toBe('2026-08-03');
    expect(parseDate('2026-08-03', 'mdy')).toBe('2026-08-03');
  });

  it('reads a spelled month regardless of the order it is handed', () => {
    expect(parseDate('3 Aug 2026', 'mdy')).toBe('2026-08-03');
    expect(parseDate('Aug 3 2026', 'dmy')).toBe('2026-08-03');
    expect(parseDate('3-AUG-26', 'mdy')).toBe('2026-08-03');
  });

  it('accepts the separators banks actually use', () => {
    expect(parseDate('03-08-2026', 'dmy')).toBe('2026-08-03');
    expect(parseDate('03.08.2026', 'dmy')).toBe('2026-08-03');
    expect(parseDate('3/8/26', 'dmy')).toBe('2026-08-03');
  });

  it('windows a two-digit year so a wrong guess is obviously wrong', () => {
    // 1970 rather than 2070 for "70". A statement is never seventy years old,
    // so the window can only fail in a direction nobody would believe.
    expect(parseDate('01/01/70', 'dmy')).toBe('1970-01-01');
    expect(parseDate('01/01/69', 'dmy')).toBe('2069-01-01');
  });

  it('rejects a date that does not exist', () => {
    // 31 February parses arithmetically into 3 March if you let Date roll it
    // over, which is a transaction silently moved to another month.
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('32/01/2026', 'dmy')).toBeNull();
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(parseDate('29/02/2028', 'dmy')).toBe('2028-02-29');
    expect(parseDate('29/02/2026', 'dmy')).toBeNull();
  });

  it('returns null for anything that is not a date', () => {
    expect(parseDate('Salary', 'dmy')).toBeNull();
    expect(parseDate('', 'dmy')).toBeNull();
  });
});

describe('isRealDate', () => {
  it('knows the length of each month', () => {
    expect(isRealDate(2026, 4, 31)).toBe(false);
    expect(isRealDate(2026, 4, 30)).toBe(true);
    expect(isRealDate(2026, 12, 31)).toBe(true);
    expect(isRealDate(2026, 13, 1)).toBe(false);
  });
});

describe('detectDecimalStyle', () => {
  it('is settled outright by a value containing both separators', () => {
    expect(detectDecimalStyle(['1,234.56'])).toBe('point');
    expect(detectDecimalStyle(['1.234,56'])).toBe('comma');
  });

  it('lets one definitive value outvote several ambiguous ones', () => {
    // "1,234" alone reads as thousands, which is also what the definitive
    // value says. The point is that a single unambiguous row settles a column.
    expect(detectDecimalStyle(['1.234,56', '250,00', '1.000'])).toBe('comma');
  });

  it('reads three trailing digits as a thousands group', () => {
    expect(detectDecimalStyle(['1,234', '5,678'])).toBe('point');
  });

  it('reads one or two trailing digits as a decimal', () => {
    expect(detectDecimalStyle(['250,00', '18,5'])).toBe('comma');
  });

  it('reads repeated separators as thousands groups', () => {
    expect(detectDecimalStyle(['1.234.567'])).toBe('comma');
  });

  it('defaults to the point when nothing in the column has a fraction', () => {
    expect(detectDecimalStyle(['1234', '5678'])).toBe('point');
    expect(detectDecimalStyle([])).toBe('point');
  });
});

describe('parseAmount', () => {
  it('reads a plain amount', () => {
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
  });

  it('reads a comma-decimal amount when told the column uses one', () => {
    expect(parseAmount('1.234,56', 'comma')).toBe(1234.56);
    expect(parseAmount('250,00', 'comma')).toBe(250);
  });

  it('is out by a thousand if the style is wrong, which is why it is detected', () => {
    // Not a defect — a demonstration of the stake. Reading a comma-decimal
    // column as point-decimal turns two hundred and fifty into twenty-five
    // thousand, and the ledger still renders.
    expect(parseAmount('250,00', 'point')).toBe(25000);
  });

  it('strips the currency banks print next to the number', () => {
    expect(parseAmount('AED 1,234.56')).toBe(1234.56);
    expect(parseAmount('1,234.56 AED')).toBe(1234.56);
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseAmount('(1,234.56)')).toBe(-1234.56);
  });

  it('reads a trailing or leading minus as negative', () => {
    expect(parseAmount('-1234.56')).toBe(-1234.56);
    expect(parseAmount('1234.56-')).toBe(-1234.56);
  });

  it('reads a DR suffix as negative and CR as positive', () => {
    expect(parseAmount('1,234.56 DR')).toBe(-1234.56);
    expect(parseAmount('1,234.56 CR')).toBe(1234.56);
  });

  it('returns null rather than zero for a cell with no number', () => {
    /*
     * Zero would be a real amount. A debit column that is blank on a credit row
     * means "not this row", and turning that into 0.00 would put a zero-value
     * transaction in the ledger for every row of the file.
     */
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('-')).toBeNull();
  });

  it('returns null for something with two decimal points', () => {
    expect(parseAmount('1.2.3')).toBeNull();
  });

  it('keeps the sign rather than making it absolute', () => {
    // ParsedRow wants a positive amount and a separate direction, and only the
    // caller knows whether a negative in this column means debit or a refund.
    expect(parseAmount('-50')).toBe(-50);
  });
});
