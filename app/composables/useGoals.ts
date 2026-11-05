import type { Goal, GoalKind } from '~/types'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Goals for the household, shared across pages. */
export function useGoals() {
  const supabase = useSupabaseClient()

  const { data, status, error, refresh } = useAsyncData<Goal[]>(
    'goals',
    async () => {
      const { data: rows, error: err } = await supabase.from('goals').select('*').order('created_at')
      if (err) throw new Error(err.message)
      return (rows ?? []).map(
        (r): Goal => ({
          id: r.id,
          household_id: r.household_id,
          created_by: r.created_by,
          name: r.name,
          kind: r.kind as GoalKind,
          target_amount: num(r.target_amount),
          target_amount_high: num(r.target_amount_high),
          target_date: r.target_date,
          current_age: num(r.current_age),
          age_set_on: r.age_set_on,
          target_age: num(r.target_age),
          annual_spending: num(r.annual_spending),
          withdrawal_rate: Number(r.withdrawal_rate),
          saved: Number(r.saved),
          linked_account_ids: r.linked_account_ids ?? [],
          monthly_contribution: Number(r.monthly_contribution),
          expected_return: Number(r.expected_return),
          active: r.active,
          note: r.note,
        }),
      )
    },
    { default: () => [] },
  )

  const goals = computed(() => data.value)
  const pending = computed(() => status.value === 'pending' || status.value === 'idle')
  return { goals, pending, error, refresh }
}

/** Every active goal with its projection, using the latest balances of the accounts it is linked to. */
export function useGoalPlans() {
  const { allAccounts, idx } = useLedger()
  const { goals, pending, error } = useGoals()
  const today = new Date()

  const plans = computed(() =>
    goals.value.map((g) => {
      const known = new Set(allAccounts.value.filter((a) => !a.archived).map((a) => a.id))
      const balance = g.linked_account_ids
        .filter((id) => known.has(id))
        .reduce((sum, id) => sum + (balanceAt(idx.value, id) ?? 0), 0)
      return planGoal(g, balance, today)
    }),
  )
  return { goals, plans, today, pending, error }
}
