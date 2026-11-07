import type { ActivityAction, ActivityEntity, ActivityRow } from '~/types'

/** The most recent things anyone in the household added, changed or deleted. */
export function useActivity(limit = 10) {
  const supabase = useSupabaseClient()

  const { data, status, error, refresh } = useAsyncData<ActivityRow[]>(
    'activity',
    async () => {
      const { data: rows, error: err } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (err) throw new Error(err.message)
      return (rows ?? []).map(
        (r): ActivityRow => ({
          id: r.id,
          actor_id: r.actor_id,
          actor_email: r.actor_email,
          action: r.action as ActivityAction,
          entity: r.entity as ActivityEntity,
          entity_id: r.entity_id,
          label: r.label,
          amount: r.amount === null ? null : Number(r.amount),
          detail: r.detail,
          created_at: r.created_at,
        }),
      )
    },
    // Always ask again when the dashboard is opened, so new changes show up.
    { default: () => [], getCachedData: () => undefined },
  )

  return { rows: computed(() => data.value ?? []), pending: computed(() => status.value === 'pending'), error, refresh }
}
