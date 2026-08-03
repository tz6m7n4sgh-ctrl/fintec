import { describe, expect, it } from 'vitest';
import { parseStatement, unsupportedReason } from './parse';
import { inferLayout } from './columns';
import { parseDelimited, sniffDelimiter } from './csv';

/**
 * Parsing a statement end to end.
 *
 * The fixtures below are the shapes UAE bank exports actually come in: a
 * debit/credit pair, a single signed amount, an amount with a Dr/Cr indicator,
 * and a few lines of account preamble above the headings.
 */

const ACCOUNT = 'acct-enbd-4821';

/** ENBD-style: preamble, then a debit/credit pair and a running balance. */
const DEBIT_CREDIT_PAIR = `Emirates NBD
Account 1234567890 — AED
Statement period 01/08/2026 to 31/08/2026

Date,Description,Debit,Credit,Balance
03/08/2026,SALARY AUGUST 2026,,32000.00,45230.50
05/08/2026,"CARLTON, DOWNTOWN",250.00,,44980.50
17/08/2026,ATM WITHDRAWAL DEIRA,1000.00,,43980.50
`;

/** A single signed column, where a withdrawal is negative. */
const SIGNED_AMOUNT = `Date,Description,Amount,Balance
03/08/2026,SALARY AUGUST 2026,32000.00,45230.50
05/08/2026,CARLTON DOWNTOWN,-250.00,44980.50
17/08/2026,ATM WITHDRAWAL DEIRA,-1000.00,43980.50
`;

/** The other convention: a withdrawal is written positive. */
const POSITIVE_IS_DEBIT = `Date,Description,Amount,Balance
03/08/2026,SALARY AUGUST 2026,-32000.00,45230.50
05/08/2026,CARLTON DOWNTOWN,250.00,44980.50
17/08/2026,ATM WITHDRAWAL DEIRA,1000.00,43980.50
`;

describe('parseStatement', () => {
  it('reads a debit and credit pair', () => {
    const result = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT);

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      bankAccountId: ACCOUNT,
      date: '2026-08-03',
      description: 'SALARY AUGUST 2026',
      amount: 32000,
      direction: 'credit',
      balanceAfter: 45230.5,
    });
    expect(result.rows[1]).toMatchObject({
      date: '2026-08-05',
      description: 'CARLTON, DOWNTOWN',
      amount: 250,
      direction: 'debit',
    });
  });

  it('skips the account preamble and says how much it skipped', () => {
    const result = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT);
    // Four: the bank name, the account line, the period line and the blank
    // row between them. Counted from the header's *file line*, so the blank
    // row that `parseDelimited` drops is still counted.
    expect(result.log.some((e) => /4 lines of preamble/.test(e.message))).toBe(true);
  });

  it('records how it read the dates, so the user can check', () => {
    /*
     * The single most consequential guess in the file. Saying it out loud is
     * what lets somebody notice that their 3 August salary was read as 8 March
     * before they confirm a hundred rows.
     */
    const result = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT);
    expect(result.log.some((e) => e.message.includes('day/month/year'))).toBe(true);
  });

  it('reads a single signed amount column', () => {
    const result = parseStatement(SIGNED_AMOUNT, ACCOUNT);
    expect(result.rows.map((r) => r.direction)).toEqual(['credit', 'debit', 'debit']);
    expect(result.rows[1].amount).toBe(250);
  });

  it('corrects the sign convention from the running balance', () => {
    /*
     * The check that earns this file its complexity. Both conventions are in
     * use. Read this bank's export the usual way and the salary becomes a
     * payment out, the rent becomes income, the projection runs backwards —
     * and every row still looks entirely normal.
     */
    const result = parseStatement(POSITIVE_IS_DEBIT, ACCOUNT);
    expect(result.rows.map((r) => r.direction)).toEqual(['credit', 'debit', 'debit']);
    expect(result.log.some((e) => /the wrong way round/.test(e.message))).toBe(true);
    expect(result.config?.positiveIsDebit).toBe(true);
  });

  it('confirms the directions when the balance already agrees', () => {
    const result = parseStatement(SIGNED_AMOUNT, ACCOUNT);
    expect(result.log.some((e) => /confirmed by the file itself/.test(e.message))).toBe(true);
  });

  it('warns rather than discards when the balance matches neither reading', () => {
    const broken = `Date,Description,Amount,Balance
03/08/2026,SALARY,32000.00,45230.50
05/08/2026,COFFEE,-25.00,11111.11
17/08/2026,RENT,-5000.00,99999.99
`;
    const result = parseStatement(broken, ACCOUNT);
    // Still imported — the delta may be an opening balance or a skipped row,
    // and throwing away a whole statement over it helps nobody.
    expect(result.rows).toHaveLength(3);
    expect(result.log.some((e) => e.level === 'error' && /does not match/.test(e.message))).toBe(true);
  });

  it('reads a Dr/Cr indicator column', () => {
    const text = `Date,Description,Amount,Type
17/08/2026,SALARY,32000.00,CR
19/08/2026,COFFEE,25.00,DR
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.rows.map((r) => r.direction)).toEqual(['credit', 'debit']);
  });

  it('skips a totals row and names the line it skipped', () => {
    const text = `Date,Description,Amount
17/08/2026,SALARY,32000.00

,TOTAL,32000.00
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.rows).toHaveLength(1);
    const skip = result.log.find((e) => e.level === 'skipped');
    /*
     * Line 4, not 3. The blank line between them is dropped as padding, so the
     * row's index and its line number have already diverged by here — which is
     * why `parseDelimited` carries the source line rather than deriving it.
     */
    expect(skip?.line).toBe(4);
    expect(skip?.message).toMatch(/No readable date/);
  });

  it('skips a row with a figure in both debit and credit rather than choosing', () => {
    const text = `Date,Description,Debit,Credit
17/08/2026,SALARY,10.00,32000.00
19/08/2026,COFFEE,25.00,
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.rows).toHaveLength(1);
    expect(result.log.some((e) => e.level === 'skipped' && e.line === 2)).toBe(true);
  });

  it('counts every row it read and every row it saw', () => {
    const result = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT);
    expect(result.log.some((e) => /Read 3 transactions from 3 rows/.test(e.message))).toBe(true);
  });

  it('refuses a file with no header rather than reading it positionally', () => {
    /*
     * A positional read works for most exports and silently transposes the two
     * columns of every export laid out differently — producing a complete,
     * plausible ledger of the wrong money.
     */
    const result = parseStatement('03/08/2026,SALARY,32000.00\n', ACCOUNT);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/No header row/);
    expect(result.log[0].level).toBe('error');
  });

  it('refuses a file whose dates could be either format', () => {
    const text = `Date,Description,Amount
03/08/2026,SALARY,32000.00
05/08/2026,COFFEE,-25.00
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.error).toMatch(/3 August or 8 March/);
  });

  it('reads that same file once the account has settled its format', () => {
    /*
     * The reason `parser_config` is saved. This file contains no evidence, and
     * the answer was established by a previous upload that did — so this is
     * carrying an answer forward, not guessing.
     */
    const settled = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT).config!;
    const text = `Date,Description,Amount
03/08/2026,SALARY,32000.00
05/08/2026,COFFEE,-25.00
`;
    const result = parseStatement(text, ACCOUNT, settled);
    expect(result.error).toBeUndefined();
    expect(result.rows[0].date).toBe('2026-08-03');
  });

  it('does not let a saved config override what this file does say', () => {
    // A bank that changes its export format must not be read with last
    // month's mapping.
    const settled = parseStatement(DEBIT_CREDIT_PAIR, ACCOUNT).config!;
    const monthFirst = `Date,Description,Amount
08/17/2026,SALARY,32000.00
09/01/2026,COFFEE,-25.00
`;
    const result = parseStatement(monthFirst, ACCOUNT, settled);
    expect(result.rows[0].date).toBe('2026-08-17');
  });

  it('says which file it could not read when every row was skipped', () => {
    const text = `Date,Description,Amount
17/08/2026,,32000.00
19/08/2026,,25.00
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.error).toMatch(/Every row was skipped/);
    expect(result.log.filter((e) => e.level === 'skipped')).toHaveLength(2);
  });

  it('reads a semicolon file with comma decimals', () => {
    const text = `Date;Description;Amount;Balance
17/08/2026;SALARY;32.000,00;45.230,50
19/08/2026;COFFEE;-250,00;44.980,50
`;
    const result = parseStatement(text, ACCOUNT);
    expect(result.rows[0].amount).toBe(32000);
    expect(result.rows[1].amount).toBe(250);
    expect(result.rows[1].direction).toBe('debit');
  });
});

describe('unsupportedReason', () => {
  it('names PDF and says what to do instead', () => {
    /*
     * US-34. A PDF read as plain text produces a scatter of numbers that a
     * lenient parser turns into convincing, wrong transactions — so this is a
     * refusal by name rather than an attempt.
     */
    expect(unsupportedReason('statement.pdf')).toMatch(/Export CSV/);
    expect(unsupportedReason('STATEMENT.PDF')).toMatch(/Export CSV/);
  });

  it('passes XLSX through to its deterministic adapter', () => {
    expect(unsupportedReason('aug.xlsx')).toBeNull();
  });

  it('passes delimited files through', () => {
    expect(unsupportedReason('aug.csv')).toBeNull();
    expect(unsupportedReason('aug.txt')).toBeNull();
  });
});

describe('inferLayout', () => {
  it('finds the header below preamble and maps every role', () => {
    const grid = parseDelimited(DEBIT_CREDIT_PAIR);
    const { config } = inferLayout(grid, sniffDelimiter(DEBIT_CREDIT_PAIR));

    expect(config?.headerRow).toBe(3);
    expect(config?.roles).toMatchObject({
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
      balance: 4,
    });
  });

  it('recognises the synonyms banks use', () => {
    const text = `Value Date|Narration|Withdrawals|Deposits|Running Balance
17/08/2026|ATM|1000.00||43980.50
`;
    const { config } = inferLayout(parseDelimited(text), '|');
    expect(config?.roles).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  });

  it('refuses a file with a date and description but no money', () => {
    const text = 'Date,Description\n03/08/2026,SALARY\n';
    expect(inferLayout(parseDelimited(text), ',').error).toMatch(/No amount column/);
  });

  it('refuses an empty file', () => {
    expect(inferLayout([], ',').error).toMatch(/no rows/);
  });

  it('refuses a header with nothing under it', () => {
    const text = 'Date,Description,Amount\n';
    expect(inferLayout(parseDelimited(text), ',').error).toMatch(/no transactions under it/);
  });
});
