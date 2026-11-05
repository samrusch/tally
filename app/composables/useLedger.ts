import type { Account, Entry, Ledger } from '~/types'

const PAGE = 1000

/** PostgREST returns at most 1000 rows per request, so page through the table. */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/**
 * Loads every account and balance entry once and shares them across pages.
 * Numeric columns arrive as numbers or strings depending on size, so coerce them.
 */
export function useLedger() {
  const supabase = useSupabaseClient()

  const { data, status, error, refresh } = useAsyncData<Ledger>(
    'ledger',
    async () => {
      const [accounts, entries] = await Promise.all([
        fetchAll((from, to) => supabase.from('accounts').select('*').order('created_at').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('balance_entries').select('*').order('entry_date').order('id').range(from, to),
        ),
      ])
      return {
        accounts: accounts.map(
          (a): Account => ({
            id: a.id,
            household_id: a.household_id,
            created_by: a.created_by,
            name: a.name,
            type: a.type as Account['type'],
            institution: a.institution,
            identifier: a.identifier,
            apr: num(a.apr),
            min_payment: num(a.min_payment),
            linked_account_id: a.linked_account_id,
            archived: a.archived,
            created_at: a.created_at,
          }),
        ),
        entries: entries.map(
          (e): Entry => ({
            id: e.id,
            account_id: e.account_id,
            created_by: e.created_by,
            entry_date: e.entry_date,
            balance: Number(e.balance),
            contribution: num(e.contribution),
            mileage: num(e.mileage),
            source: e.source,
            note: e.note,
          }),
        ),
      }
    },
    { default: () => ({ accounts: [], entries: [] }) },
  )

  const allAccounts = computed(() => data.value.accounts)
  const accounts = computed(() => allAccounts.value.filter((a) => !a.archived))
  const entries = computed(() => data.value.entries)
  const idx = computed(() => indexEntries(entries.value))
  const pending = computed(() => status.value === 'pending' || status.value === 'idle')

  return { allAccounts, accounts, entries, idx, pending, error, refresh }
}
