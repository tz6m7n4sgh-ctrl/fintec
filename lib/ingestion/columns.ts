import type { Delimiter, SourceRow } from './csv';
import { column } from './csv';
import { detectDateOrder, detectDecimalStyle, type DateOrder, type DecimalStyle } from './values';

/**
 * Working out which column is which (US-28 / FR-L2 / D2).
 *
 * ## Why the answer is saved rather than re-derived
 *
 * `bank_accounts.parser_config` has existed since migration 0001, described as
 * a saved column mapping for repeat uploads from the same bank, and nothing has
 * ever written it. This is what writes it.
 *
 * Saving matters for one reason beyond speed: inference can be *correct but
 * unavailable*. A statement covering only the first twelve days of a month
 * contains no evidence of whether `03/08` is day-first or month-first — see
 * `detectDateOrder` — so that file is refused on its own. The same account's
 * previous upload, which happened to span a whole month, settled it. Carrying
 * that answer forward turns a refusal into a parse, without ever guessing.
 *
 * ## Why a missing header is a refusal
 *
 * A headerless file could be read positionally — first column a date, second a
 * description, third an amount — and it would work for most exports. It would
 * also silently transpose the two columns of every export that puts the amount
 * before the description, and produce a complete, plausible ledger of the wrong
 * money. There is no evidence to resolve that, so there is no guess.
 */

/** Where each meaning lives, as a column index into the grid. */
export interface ColumnRoles {
  date: number;
  description: number;
  /** A single signed column. Mutually exclusive with `debit`/`credit`. */
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  /** A `Dr`/`Cr` indicator column, where the bank uses one. */
  indicator?: number;
}

export interface ParserConfig {
  version: 1;
  delimiter: Delimiter;
  /** Index of the header row among the parsed rows. Rows above it are preamble. */
  headerRow: number;
  dateOrder: DateOrder;
  decimalStyle: DecimalStyle;
  roles: ColumnRoles;
  /**
   * Whether a positive value in a single `amount` column means money leaving.
   *
   * Both conventions exist. Where the file carries a running balance this is
   * *measured* rather than assumed — see `checkAgainstBalance` in `parse.ts`.
   */
  positiveIsDebit: boolean;
}

/**
 * Header names seen in UAE bank exports, plus the obvious synonyms.
 *
 * Matched against a normalised cell — lowercased, punctuation and spaces
 * removed — so `Value Date`, `value-date` and `VALUEDATE` are one entry.
 */
const HEADERS: Record<keyof ColumnRoles, readonly string[]> = {
  date: [
    'date', 'transactiondate', 'txndate', 'trndate', 'valuedate', 'postingdate',
    'bookingdate', 'processdate', 'dateoftransaction',
  ],
  description: [
    'description', 'narration', 'details', 'particulars', 'remarks', 'reference',
    'transactiondetails', 'transactiondescription', 'narrative', 'payee',
  ],
  debit: ['debit', 'debits', 'debitamount', 'withdrawal', 'withdrawals', 'paidout', 'moneyout', 'dr'],
  credit: ['credit', 'credits', 'creditamount', 'deposit', 'deposits', 'paidin', 'moneyin', 'cr'],
  amount: ['amount', 'transactionamount', 'amountaed', 'value', 'amt'],
  balance: ['balance', 'runningbalance', 'closingbalance', 'balanceafter', 'ledgerbalance', 'availablebalance'],
  indicator: ['drcr', 'crdr', 'debitcredit', 'type', 'transactiontype', 'indicator'],
};

/** Lowercased, with everything that is not a letter or digit removed. */
function normaliseHeader(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roleOf(cell: string): keyof ColumnRoles | null {
  const key = normaliseHeader(cell);
  if (!key) return null;

  for (const [role, names] of Object.entries(HEADERS) as [keyof ColumnRoles, string[]][]) {
    if (names.includes(key)) return role;
  }
  return null;
}

export interface LayoutResult {
  config?: ParserConfig;
  /** Present when the file cannot be read. Written to be shown to the user. */
  error?: string;
}

/**
 * Reads a grid and returns how to interpret it, or why it cannot be.
 *
 * `saved` is a previous config for the same bank account. It is used for one
 * thing only — supplying a `dateOrder` this file has no evidence for — and
 * never to override what this file does say. A bank that changes its export
 * format must not be read with last month's mapping.
 */
export function inferLayout(
  rows: readonly SourceRow[],
  delimiter: Delimiter,
  saved?: ParserConfig | null,
): LayoutResult {
  if (rows.length === 0) return { error: 'That file has no rows in it.' };

  // Statements often carry a few lines of account preamble before the header.
  let headerRow = -1;
  let roles: Partial<Record<keyof ColumnRoles, number>> = {};

  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const found: Partial<Record<keyof ColumnRoles, number>> = {};
    rows[i].cells.forEach((cell, index) => {
      const role = roleOf(cell);
      // First match wins: a statement with both "Date" and "Value Date" uses
      // the first, which is the posting date every UAE bank puts leftmost.
      if (role && found[role] === undefined) found[role] = index;
    });

    if (found.date !== undefined && found.description !== undefined) {
      headerRow = i;
      roles = found;
      break;
    }
  }

  if (headerRow === -1) {
    return {
      error:
        'No header row was found. This file needs a row naming its columns — at least a date column and a description column — because reading them by position instead would quietly mis-assign every value in a file laid out differently.',
    };
  }

  const hasPair = roles.debit !== undefined && roles.credit !== undefined;
  if (!hasPair && roles.amount === undefined) {
    return {
      error:
        'No amount column was found. This file needs either an "Amount" column or a "Debit" and "Credit" pair.',
    };
  }

  const body = rows.slice(headerRow + 1);
  if (body.length === 0) return { error: 'That file has a header but no transactions under it.' };

  const dateOrderResult = detectDateOrder(column(body, roles.date!));
  let dateOrder = dateOrderResult.order;

  if (!dateOrder) {
    /*
     * The saved config is consulted only here, and only when this file is
     * genuinely silent. That is not a guess carried forward — it is an answer
     * this account established from a file that did contain the evidence.
     */
    if (dateOrderResult.order === null && dateOrderResult.ambiguous && saved?.dateOrder) {
      dateOrder = saved.dateOrder;
    } else {
      return {
        error: `${dateOrderResult.reason} Upload a statement covering a full month from this account first, and this one can then be read with the same format.`,
      };
    }
  }

  const amountColumns = [roles.amount, roles.debit, roles.credit, roles.balance]
    .filter((index): index is number => index !== undefined);
  const decimalStyle = detectDecimalStyle(amountColumns.flatMap((index) => column(body, index)));

  const config: ParserConfig = {
    version: 1,
    delimiter,
    headerRow,
    dateOrder,
    decimalStyle,
    roles: {
      date: roles.date!,
      description: roles.description!,
      ...(hasPair ? { debit: roles.debit, credit: roles.credit } : { amount: roles.amount }),
      ...(roles.balance !== undefined ? { balance: roles.balance } : {}),
      ...(roles.indicator !== undefined ? { indicator: roles.indicator } : {}),
    },
    /*
     * A starting position, not a conclusion. Nearly every export writes a
     * withdrawal as a negative amount, and `parse.ts` measures this against the
     * running balance where the file carries one.
     */
    positiveIsDebit: false,
  };

  return { config };
}

/** Whether a stored value is a config this version knows how to use. */
export function isParserConfig(value: unknown): value is ParserConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ParserConfig>;
  return (
    candidate.version === 1 &&
    typeof candidate.headerRow === 'number' &&
    typeof candidate.dateOrder === 'string' &&
    typeof candidate.roles === 'object' &&
    typeof candidate.roles?.date === 'number'
  );
}
