<script setup lang="ts">
import type { Member, Role } from '~/types'

useHead({ title: 'Members · Tally' })

const supabase = useSupabaseClient()
const toast = useToast()
const { household, pending, error, isOwner, refresh } = useHousehold()

const ROLES: Role[] = ['owner', 'editor', 'contributor', 'viewer']
const INVITE_ROLES = ['editor', 'contributor', 'viewer'] as const

const permissions: { what: string; allowed: Record<Role, boolean | 'own'> }[] = [
  { what: 'See everything', allowed: { owner: true, editor: true, contributor: true, viewer: true } },
  { what: 'Add accounts and balance updates', allowed: { owner: true, editor: true, contributor: true, viewer: false } },
  { what: 'Change or delete accounts and updates', allowed: { owner: true, editor: true, contributor: 'own', viewer: false } },
  { what: 'Invite people, change roles, remove people', allowed: { owner: true, editor: false, contributor: false, viewer: false } },
]

const ownerCount = computed(() => household.value?.members.filter((m) => m.role === 'owner').length ?? 0)

/* ------------------------------ Invite ------------------------------- */

const email = ref('')
const inviteRole = ref<(typeof INVITE_ROLES)[number]>('viewer')
const inviting = ref(false)
const lastPending = ref<string | null>(null)

async function invite() {
  if (!household.value || inviting.value) return
  inviting.value = true
  lastPending.value = null
  const { data, error: err } = await supabase.rpc('invite_member', {
    h: household.value.id,
    mail: email.value,
    member_role: inviteRole.value,
  })
  inviting.value = false
  if (err) return toast.error(friendlyError(err))
  if (data === 'added') {
    toast.success(`${email.value.trim().toLowerCase()} now has access`)
  } else {
    lastPending.value = email.value.trim().toLowerCase()
    toast.success('Invitation saved')
  }
  email.value = ''
  await refresh()
}

async function cancelInvite(id: string) {
  const { data, error: err } = await supabase.from('household_invites').delete().eq('id', id).select('id')
  if (err) return toast.error(friendlyError(err))
  if (!data?.length) return toast.error(friendlyError('permission denied'))
  toast.success('Invitation cancelled')
  await refresh()
}

/* --------------------------- Members ---------------------------------- */

const busy = ref<string | null>(null)

async function changeRole(m: Member, ev: Event) {
  if (!household.value) return
  const el = ev.target as HTMLSelectElement
  const next = el.value as Role
  if (next === m.role) return
  busy.value = m.user_id
  const { data, error: err } = await supabase
    .from('household_members')
    .update({ role: next })
    .eq('household_id', household.value.id)
    .eq('user_id', m.user_id)
    .select('user_id')
  busy.value = null
  if (err || !data?.length) {
    el.value = m.role
    return toast.error(err ? friendlyError(err) : friendlyError('permission denied'))
  }
  toast.success('Role changed')
  await refresh()
  // Changing your own role can take away your access to this page's controls.
  if (m.user_id === household.value?.userId) await refreshNuxtData('household')
}

async function removeMember(m: Member) {
  if (!household.value) return
  const self = m.user_id === household.value.userId
  const who = self ? 'yourself' : (m.email ?? 'this person')
  const msg = self
    ? 'Leave this household? You will lose access to its data.'
    : `Remove ${who}? They will lose access straight away.`
  if (!confirm(msg)) return
  busy.value = m.user_id
  const { data, error: err } = await supabase
    .from('household_members')
    .delete()
    .eq('household_id', household.value.id)
    .eq('user_id', m.user_id)
    .select('user_id')
  busy.value = null
  if (err) return toast.error(friendlyError(err))
  if (!data?.length) return toast.error(friendlyError('permission denied'))
  toast.success(self ? 'You left the household' : 'Person removed')
  if (self) {
    clearNuxtData('ledger')
    await refreshNuxtData('household')
    return
  }
  await refresh()
}

const joined = (iso: string) => fmtDate(iso.slice(0, 10))
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Members</h1>
      <p class="text-base-content/70 text-sm">
        Who can see and change the data in {{ household?.name ?? 'this household' }}.
      </p>
    </header>

    <div v-if="pending && !household" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>
    <div v-else-if="error" role="alert" class="alert alert-error"><span>{{ error.message }}</span></div>

    <template v-else-if="household">
      <!-- People -->
      <section class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="People">
        <div class="overflow-x-auto">
          <table class="table min-w-[34rem]">
            <thead>
              <tr class="text-base-content/70 text-xs">
                <th>Person</th>
                <th>Role</th>
                <th>Joined</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in household.members" :key="m.user_id">
                <td>
                  <span class="font-medium">{{ m.email ?? 'Unknown email' }}</span>
                  <span v-if="m.user_id === household.userId" class="badge badge-ghost badge-sm ml-2">You</span>
                </td>
                <td>
                  <select
                    v-if="isOwner"
                    class="select select-sm w-36"
                    :aria-label="`Role for ${m.email ?? 'member'}`"
                    :value="m.role"
                    :disabled="busy === m.user_id"
                    @change="changeRole(m, $event)"
                  >
                    <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
                  </select>
                  <span v-else class="badge badge-outline">{{ ROLE_LABEL[m.role] }}</span>
                </td>
                <td class="text-base-content/70 text-sm">{{ joined(m.created_at) }}</td>
                <td class="text-right whitespace-nowrap">
                  <button
                    v-if="isOwner && m.user_id !== household.userId"
                    class="btn btn-ghost btn-xs text-error"
                    :disabled="busy === m.user_id"
                    @click="removeMember(m)"
                  >
                    Remove
                  </button>
                  <button
                    v-else-if="m.user_id === household.userId && !(m.role === 'owner' && ownerCount < 2)"
                    class="btn btn-ghost btn-xs text-error"
                    :disabled="busy === m.user_id"
                    @click="removeMember(m)"
                  >
                    Leave
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Invite -->
      <section v-if="isOwner" class="card border-base-300 bg-base-100 border" aria-label="Invite someone">
        <form class="card-body gap-4" @submit.prevent="invite">
          <div>
            <h2 class="font-semibold">Invite someone</h2>
            <p class="text-base-content/70 text-sm">
              Enter their email and pick what they can do. You can change it any time.
            </p>
          </div>
          <div class="grid grid-cols-1 items-end gap-4 sm:grid-cols-5">
            <fieldset class="fieldset sm:col-span-3">
              <label class="label" for="inv-email">Email</label>
              <input id="inv-email" v-model="email" type="email" class="input w-full" required placeholder="name@example.com" autocomplete="off" />
            </fieldset>
            <fieldset class="fieldset sm:col-span-1">
              <label class="label" for="inv-role">Role</label>
              <select id="inv-role" v-model="inviteRole" class="select w-full">
                <option v-for="r in INVITE_ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
              </select>
            </fieldset>
            <button type="submit" class="btn btn-primary sm:col-span-1" :disabled="inviting">
              <span v-if="inviting" class="loading loading-spinner loading-sm" />
              Invite
            </button>
          </div>

          <div v-if="household.invites.length" class="border-base-300 rounded-box border">
            <div class="text-base-content/70 border-base-300 border-b px-4 py-2 text-xs">Waiting to sign in</div>
            <ul>
              <li v-for="i in household.invites" :key="i.id" class="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <span class="font-medium">{{ i.email }}</span>
                  <span class="badge badge-outline badge-sm ml-2">{{ ROLE_LABEL[i.role] }}</span>
                </span>
                <button type="button" class="btn btn-ghost btn-xs text-error" @click="cancelInvite(i.id)">Cancel</button>
              </li>
            </ul>
          </div>

          <div v-if="household.invites.length || lastPending" role="note" class="alert alert-info text-sm">
            <span>
              <span class="font-medium">One more step for anyone who doesn't have a login yet.</span>
              In Supabase open Authentication, then Users, then Add user. Enter their email and a password and tick
              <em>Auto Confirm User</em>. When they sign in to Tally with it, they join automatically with the role
              above.
            </span>
          </div>
        </form>
      </section>

      <!-- What each role can do -->
      <section class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="What each role can do">
        <div class="card-body pb-2">
          <h2 class="font-semibold">What each role can do</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="table min-w-[34rem]">
            <thead>
              <tr class="text-base-content/70 text-xs">
                <th />
                <th v-for="r in ROLES" :key="r" class="text-center">{{ ROLE_LABEL[r] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in permissions" :key="p.what">
                <td>{{ p.what }}</td>
                <td v-for="r in ROLES" :key="r" class="text-center">
                  <span v-if="p.allowed[r] === true" class="text-success" aria-label="Yes">✓</span>
                  <span v-else-if="p.allowed[r] === 'own'" class="text-warning text-xs" aria-label="Only their own">only their own</span>
                  <span v-else class="text-base-content/30" aria-label="No">–</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-base-content/70 px-6 pb-5 text-xs">
          A contributor can delete an account they created only while all of its history is theirs too.
        </p>
      </section>
    </template>
  </div>
</template>
