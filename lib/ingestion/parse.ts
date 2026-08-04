import type { ParsedRow } from './dedupe';
import { parseDelimited, sniffDelimiter } from './csv';
import { inferLayout, type ParserConfig } from './columns';
import { parseAmount, parseDate } from './values';

/**
 * A statement file to rows, and a record of what happened (US-28 / US-34 /
 * NFR-6 / FR-L2).
 *
 * ## The processing log is the feature, not decoration
 *
 * `statement_uploads.processing_log` has existed since migration 0001,
 * described as *"per-file processing log surfaced in the UI (NFR-6)"*, and
 * nothing has ever written it. HAD-8 stayed open on exactly that criterion.
 *
 * It exists because the interesting outcome of parsing a statement is rarely
 * "worked" or "failed". It is "worked, and skipped four rows" — and a user who
 * is told 96 of 100 rows were imported, with no way to learn which four or why,
 * has been handed a ledger they cannot trust and cannot check. Every skip below
 * writes a line naming the row and the reason.
 *
 * ## What it refuses
 *
 * PDF. It needs layout reconstruction or a model, and is not served by this
 * file pretending to try — a PDF read
 * as text produces a scattering of numbers that a lenient parser will happily
 * turn into transactions. So they are named and refused (US-34).
 */

/** One line of `statement_uploads.processing_log`. */
export interface LogEntry {
  /** `info` explains, `skipped` names a row that did not become a transaction. */
  level: 'info' | 'skipped' | 'error';
  message: string;
  /** 1-based line in the source file, where the entry is about one row. */
  line?: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  log: LogEntry[];
  /** Present when nothing could be parsed at all. */
  error?: string;
  /** Written back to `bank_accounts.parser_config` on success. */
  config?: ParserConfig;
}

/** Extensions this parser handles, and what to say about the ones it does not. */
const UNSUPPORTED: Record<string, string> = {
  pdf: 'PDF statements are not parsed yet. Reading one needs layout reconstruction, and a PDF read as plain text produces a scatter of numbers that would import as convincing, wrong transactions. Export CSV from your bank instead — every UAE bank offers it.',
};

export function unsupportedReason(filename: string): string | null {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return UNSUPPORTED[extension] ?? null;
}

/**
 * Reads a delimited statement.
 *
 * `saved` is this bank account's config from a previous upload. It supplies a
 * date order this file has no evidence for, and nothing else — see
 * `inferLayout`.
 */
export function parseStatement(
  text: string,
  bankAccountId: string,
  saved?: ParserConfig | null,
): ParseResult {
  const log: LogEntry[] = [];

  const delimiter = saved?.delimiter ?? sniffDelimiter(text);
  const grid = parseDelimited(text, delimiter);

  const layout = inferLayout(grid, delimiter, saved);
  if (!layout.config) {
    return { rows: [], log: [{ level: 'error', message: layout.error! }], error: layout.error };
  }

  const config = layout.config;
  const { roles, dateOrder, decimalStyle, headerRow } = config;

  const headerLine = grid[headerRow].line;
  if (headerLine > 1) {
    const preamble = headerLine - 1;
    log.push({
      level: 'info',
      message: `Skipped ${preamble} line${preamble === 1 ? '' : 's'} of preamble above the column headings.`,
    });
  }
  log.push({
    level: 'info',
    message: `Read dates as ${describeOrder(dateOrder)} and "${decimalStyle === 'point' ? '.' : ','}" as the decimal point.`,
  });

  const body = grid.slice(headerRow + 1);
  const rows: ParsedRow[] = [];
  /** Parallel to `rows`, for the balance check. Undefined where absent. */
  const balances: (number | undefined)[] = [];

  body.forEach(({ cells, line }) => {

    const date = parseDate(cells[roles.date] ?? '', dateOrder);
    if (!date) {
      log.push({
        level: 'skipped',
        line,
        message: `No readable date in "${truncate(cells[roles.date] ?? '')}". Totals and subtotal lines look like this.`,
      });
      return;
    }

    const description = (cells[roles.description] ?? '').trim();
    if (!description) {
      log.push({ level: 'skipped', line, message: 'No description.' });
      return;
    }

    const money = readAmount(cells, config);
    if (!money) {
      log.push({
        level: 'skipped',
        line,
        message: `No readable amount for "${truncate(description)}".`,
      });
      return;
    }

    const balanceCell = roles.balance !== undefined ? cells[roles.balance] : undefined;
    const balance = balanceCell ? parseAmount(balanceCell, decimalStyle) : null;

    rows.push({
      bankAccountId,
      date,
      description,
      amount: Math.abs(money.signed),
      direction: money.direction,
      ...(balance !== null && balance !== undefined ? { balanceAfter: balance } : {}),
    });
    balances.push(balance ?? undefined);
  });

  if (rows.length === 0) {
    const error =
      'No transactions could be read from that file. Every row was skipped — the log below says why for each one.';
    return { rows: [], log: [...log, { level: 'error', message: error }], error, config };
  }

  const corrected = checkAgainstBalance(rows, balances, config, log);

  log.push({
    level: 'info',
    message: `Read ${corrected.length} transaction${corrected.length === 1 ? '' : 's'} from ${body.length} row${body.length === 1 ? '' : 's'}.`,
  });

  return { rows: corrected, log, config };
}

/** `dmy` → something a person can check against their own file. */
function describeOrder(order: ParserConfig['dateOrder']): string {
  if (order === 'dmy') return 'day/month/year';
  if (order === 'mdy') return 'month/day/year';
  return 'year-month-day';
}

function truncate(value: string): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

/**
 * The signed amount and its direction, from whichever shape this file uses.
 *
 * Three layouts, in order of how much they say for themselves. A debit/credit
 * pair states the direction outright. An indicator column states it. A single
 * signed column only implies it, which is what `positiveIsDebit` and the
 * balance check below are for.
 */
function readAmount(
  cells: readonly string[],
  config: ParserConfig,
): { signed: number; direction: 'credit' | 'debit' } | null {
  const { roles, decimalStyle } = config;

  if (roles.debit !== undefined && roles.credit !== undefined) {
    const debit = parseAmount(cells[roles.debit] ?? '', decimalStyle);
    const credit = parseAmount(cells[roles.credit] ?? '', decimalStyle);

    /*
     * A row with a figure in both columns is not a transaction this parser
     * understands, and picking one would be inventing the answer. Null here
     * becomes a skip entry naming the line.
     */
    if (debit !== null && credit !== null && debit !== 0 && credit !== 0) return null;

    if (debit !== null && debit !== 0) return { signed: -Math.abs(debit), direction: 'debit' };
    if (credit !== null && credit !== 0) return { signed: Math.abs(credit), direction: 'credit' };
    return null;
  }

  if (roles.amount === undefined) return null;
  const amount = parseAmount(cells[roles.amount] ?? '', decimalStyle);
  if (amount === null || amount === 0) return null;

  if (roles.indicator !== undefined) {
    const indicator = (cells[roles.indicator] ?? '').trim().toLowerCase();
    if (/^(dr|debit|d|withdrawal|w)$/.test(indicator)) {
      return { signed: -Math.abs(amount), direction: 'debit' };
    }
    if (/^(cr|credit|c|deposit)$/.test(indicator)) {
      return { signed: Math.abs(amount), direction: 'credit' };
    }
    // An indicator column that says something else is not evidence; fall
    // through to the sign rather than treating an unknown word as a credit.
  }

  const isDebit = config.positiveIsDebit ? amount > 0 : amount < 0;
  return { signed: amount, direction: isDebit ? 'debit' : 'credit' };
}

/**
 * Uses the running balance to check — and where necessary correct — the sign.
 *
 * Where a file carries a balance column it has stated the answer twice, and the
 * two statements have to agree: each balance minus the one before it is that
 * row's signed amount. That makes the sign convention *measurable* rather than
 * assumed, which matters because both conventions are in use and choosing wrong
 * inverts every transaction in the file. Income becomes spending, the projection
 * runs the wrong way, and every row still looks entirely normal.
 *
 * Three outcomes, all logged:
 *   - the balance agrees with the parse — say so, because a confirmed parse is
 *     worth more to the user than a silent one
 *   - it agrees only with every direction flipped — flip them, and say so
 *   - it agrees with neither — leave the parse alone and warn, because the
 *     mismatch may be an opening balance or a row this parser skipped, and
 *     discarding a whole statement over an unexplained delta helps nobody
 */
function checkAgainstBalance(
  rows: ParsedRow[],
  balances: readonly (number | undefined)[],
  config: ParserConfig,
  log: LogEntry[],
): ParsedRow[] {
  const pairs: { delta: number; signed: number }[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const before = balances[i - 1];
    const after = balances[i];
    if (before === undefined || after === undefined) continue;

    const signed = rows[i].direction === 'debit' ? -rows[i].amount : rows[i].amount;
    pairs.push({ delta: round(after - before), signed: round(signed) });
  }

  if (pairs.length === 0) return rows;

  const agrees = pairs.filter((p) => p.delta === p.signed).length;
  const agreesFlipped = pairs.filter((p) => p.delta === round(-p.signed)).length;

  if (agrees >= agreesFlipped && agrees > pairs.length / 2) {
    log.push({
      level: 'info',
      message: `Checked against the running balance: ${agrees} of ${pairs.length} rows agree, so the debit and credit directions are confirmed by the file itself.`,
    });
    return rows;
  }

  if (agreesFlipped > pairs.length / 2) {
    log.push({
      level: 'info',
      message: `The running balance says this bank writes money leaving the account as a positive number, so ${rows.length} rows had their direction corrected. Without this check every transaction would have been imported the wrong way round.`,
    });
    config.positiveIsDebit = !config.positiveIsDebit;
    return rows.map((row) => ({
      ...row,
      direction: row.direction === 'debit' ? 'credit' : 'debit',
    }));
  }

  log.push({
    level: 'error',
    message: `The running balance does not match the amounts: only ${agrees} of ${pairs.length} rows add up. Check the imported rows against your statement before confirming them — some rows may be missing or read wrongly.`,
  });
  return rows;
}

/** Two decimal places, so floating-point noise is not a mismatch. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
