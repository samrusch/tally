import type { Account, Entry, HouseholdInfo, Invite, Member, Role } from '~/types'

/**
 * The household the signed-in person belongs to, their role in it, and who else is in it.
 *
 * This only decides what the screens offer. The database enforces the same rules with row level
 * security, so a hidden button is a convenience and never the thing keeping the data safe.
 */
export function useHousehold() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const { data, status, error, refresh } = useAsyncData<HouseholdInfo | null>('household', async () => {
    // Turn any invitation waiting for this person's email into a membership first.
    await supabase.rpc('accept_invites')

    const userId = user.value?.sub ?? (await supabase.auth.getSession()).data.session?.user.id
    if (!userId) return null

    const mine = await supabase
      .from('household_members')
      .select('household_id, role, created_at')
      .eq('user_id', userId)
      .order('created_at')
    if (mine.error) throw new Error(mine.error.message)
    const membership = mine.data?.[0]
    if (!membership) return null

    const [house, members] = await Promise.all([
      supabase.from('households').select('id, name').eq('id', membership.household_id).single(),
      supabase
        .from('household_members')
        .select('user_id, role, email, created_at')
        .eq('household_id', membership.household_id)
        .order('created_at'),
    ])
    if (house.error) throw new Error(house.error.message)
    if (members.error) throw new Error(members.error.message)

    let invites: Invite[] = []
    if (membership.role === 'owner') {
      const inv = await supabase
        .from('household_invites')
        .select('id, email, role, created_at')
        .eq('household_id', membership.household_id)
        .order('created_at')
      if (inv.error) throw new Error(inv.error.message)
      invites = (inv.data ?? []) as Invite[]
    }

    return {
      id: house.data.id,
      name: house.data.name,
      role: membership.role as Role,
      userId,
      members: (members.data ?? []) as Member[],
      invites,
    }
  })

  const household = computed(() => data.value)
  const pending = computed(() => status.value === 'pending' || status.value === 'idle')
  const role = computed<Role | null>(() => household.value?.role ?? null)
  const isOwner = computed(() => role.value === 'owner')
  const isViewer = computed(() => role.value === 'viewer')
  const canAdd = computed(() => role.value === 'owner' || role.value === 'editor' || role.value === 'contributor')
  const canEditAll = computed(() => role.value === 'owner' || role.value === 'editor')

  /** Can this person change or delete something that was created by `createdBy`? */
  function canModify(createdBy: string | null): boolean {
    if (canEditAll.value) return true
    return role.value === 'contributor' && !!createdBy && createdBy === household.value?.userId
  }

  /** Contributors may delete their own account only while all of its history is theirs too. */
  function canDeleteAccount(account: Account, entries: Entry[]): boolean {
    if (canEditAll.value) return true
    return canModify(account.created_by) && entries.every((e) => e.created_by === household.value?.userId)
  }

  return { household, pending, error, refresh, role, isOwner, isViewer, canAdd, canEditAll, canModify, canDeleteAccount }
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  contributor: 'Contributor',
  viewer: 'Viewer',
}

export const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, plus inviting people, changing roles and removing people.',
  editor: 'Add, change and delete anything.',
  contributor: 'Add accounts and balance updates. Change or delete only what they created.',
  viewer: 'See everything. Cannot change anything.',
}
