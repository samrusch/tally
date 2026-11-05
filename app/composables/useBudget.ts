import type { BudgetItem, Frequency, IncomeSource } from '~/types'

const num = (v: unknown) => Number(v)

/** Income sources and planned budget items for the household, shared across pages. */
export function useBudget() {
  const supabase = useSupabaseClient()

  const { data, status, error, refresh } = useAsyncData<{ income: IncomeSource[]; items: BudgetItem[] }>(
    'budget',
    async () => {
      const [inc, items] = await Promise.all([
        supabase.from('income_sources').select('*').order('created_at'),
        supabase.from('budget_items').select('*').order('created_at'),
      ])
      if (inc.error) throw new Error(inc.error.message)
      if (items.error) throw new Error(items.error.message)
      return {
        income: (inc.data ?? []).map(
          (r): IncomeSource => ({
            id: r.id,
            household_id: r.household_id,
            created_by: r.created_by,
            name: r.name,
            amount: num(r.amount),
            frequency: r.frequency as Frequency,
            active: r.active,
            note: r.note,
          }),
        ),
        items: (items.data ?? []).map(
          (r): BudgetItem => ({
            id: r.id,
            household_id: r.household_id,
            created_by: r.created_by,
            name: r.name,
            kind: r.kind as BudgetItem['kind'],
            category: r.category,
            amount: num(r.amount),
            frequency: r.frequency as Frequency,
            flexible: r.flexible,
            active: r.active,
            note: r.note,
          }),
        ),
      }
    },
    { default: () => ({ income: [], items: [] }) },
  )

  const income = computed(() => data.value.income)
  const items = computed(() => data.value.items)
  const pending = computed(() => status.value === 'pending' || status.value === 'idle')

  return { income, items, pending, error, refresh }
}

/**
 * The budget summary, with debt minimums taken from the debts you've entered on the Accounts page.
 * Debts with no minimum entered count as $0 here and are reported in `missingMinimums`.
 */
export function useBudgetSummary() {
  const { accounts, idx } = useLedger()
  const { income, items, pending, error } = useBudget()

  const debts = computed(() => debtInputs(accounts.value, idx.value, true))
  const debtMinimums = computed(() => debts.value.reduce((s, d) => s + (d.minPayment ?? 0), 0))
  const missingMinimums = computed(() => debts.value.filter((d) => !d.minPayment).length)
  const summary = computed(() => summarizeBudget(income.value, items.value, debtMinimums.value))

  return { income, items, debts, debtMinimums, missingMinimums, summary, pending, error }
}
