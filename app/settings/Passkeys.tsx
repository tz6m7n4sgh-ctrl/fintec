import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/engine/dates';
import { PasskeyManager, type PasskeyRow } from './PasskeyManager';

/**
 * The passkey section of Settings (US-40 / HAD-17).
 *
 * The list is fetched here rather than in the client component so the rows
 * arrive already rendered — a list of the ways into an account should not
 * appear a moment after the rest of the page, and it means no Supabase client
 * in the browser bundle for a read the server has already done.
 *
 * No `.eq('user_id', …)` on the query. The select policy is the boundary, and
 * a redundant filter here would mean a broken policy still produced a correct
 * screen — the failure would be invisible until something else read the table.
 */

/**
 * A timestamptz rendered the way every other date in this app is.
 *
 * Sliced to a date in UTC rather than converted to Dubai time, and that is a
 * deliberate limitation rather than an oversight: a passkey added at 3am Dubai
 * would read as the previous day. The alternative is a timezone conversion on
 * a line that exists to answer "was this recent", and being one day out never
 * changes that answer. Every figure that a decision depends on goes through
 * `todayInDubai` instead.
 */
function asDate(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const iso = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDate(iso) : null;
}

export async function Passkeys() {
  const supabase = await createClient();
  if (!supabase) return <PasskeyManager passkeys={[]} />;

  const { data, error } = await supabase
    .from('passkeys')
    .select('id, device_label, transports, created_at, last_used_at')
    .order('created_at', { ascending: true });

  /*
   * An error here means the query failed, not that there are no passkeys, and
   * the two must not look the same. "You have no passkeys" on a failed read
   * would invite a user to register a second one they already have — or worse,
   * to believe nothing can sign in to their account when something can.
   */
  if (error) return <PasskeyManager passkeys={[]} unreadable />;

  const passkeys: PasskeyRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    label: (row.device_label as string) || 'Passkey',
    transports: (row.transports ?? []) as string[],
    added: asDate(row.created_at as string),
    lastUsed: asDate(row.last_used_at as string | null),
  }));

  return <PasskeyManager passkeys={passkeys} />;
}
