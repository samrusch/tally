<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()
const { toasts } = useToast()
const { household, pending: householdPending, error: householdError, isViewer } = useHousehold()

const drawerOpen = ref(false)
watch(() => route.fullPath, () => (drawerOpen.value = false))

const links = [
  { to: '/', label: 'Dashboard', match: (p: string) => p === '/' },
  { to: '/accounts', label: 'Accounts', match: (p: string) => p.startsWith('/accounts') },
  { to: '/budget', label: 'Budget', match: (p: string) => p.startsWith('/budget') },
  { to: '/debt', label: 'Debt planner', match: (p: string) => p.startsWith('/debt') },
  { to: '/members', label: 'Members', match: (p: string) => p.startsWith('/members') },
]

async function signOut() {
  await supabase.auth.signOut()
  clearNuxtData('ledger')
  clearNuxtData('household')
  clearNuxtData('budget')
  await navigateTo('/login')
}
</script>

<template>
  <div class="drawer lg:drawer-open bg-base-200 min-h-screen">
    <input id="nav-drawer" v-model="drawerOpen" type="checkbox" class="drawer-toggle" aria-label="Toggle navigation" />

    <div class="drawer-content flex flex-col">
      <div class="navbar bg-base-100 border-base-300 border-b lg:hidden">
        <label for="nav-drawer" class="btn btn-ghost btn-square" aria-label="Open navigation">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </label>
        <span class="text-lg font-semibold">Tally</span>
      </div>

      <main class="p-4 sm:p-8">
        <div v-if="householdPending" class="flex justify-center py-24">
          <span class="loading loading-spinner loading-lg text-primary" />
        </div>
        <div v-else-if="householdError" role="alert" class="alert alert-error mx-auto max-w-2xl">
          <span>
            Could not load your household: {{ householdError.message }}. If you just upgraded, make sure you ran the
            latest <code>supabase/schema.sql</code> in the Supabase SQL Editor.
          </span>
        </div>
        <div v-else-if="!household" class="card border-base-300 bg-base-100 mx-auto max-w-2xl border">
          <div class="card-body gap-3 py-12 text-center">
            <h1 class="card-title justify-center text-2xl">You don't have access yet</h1>
            <p class="text-base-content/70">
              You're signed in as <span class="font-medium">{{ user?.email }}</span>, but this address hasn't been added to a
              household. Ask the owner to invite it from the Members page in Tally, then reload this page.
            </p>
            <p class="text-base-content/70 text-sm">
              Setting this up for the first time? Create your user in Supabase, then run
              <code>supabase/schema.sql</code> again. The first user becomes the owner.
            </p>
          </div>
        </div>
        <template v-else>
          <div v-if="isViewer" role="status" class="alert alert-info mx-auto mb-4 max-w-6xl py-2 text-sm">
            <span>You have view-only access to {{ household.name }}. Ask the owner if you need to make changes.</span>
          </div>
          <slot />
        </template>
      </main>
    </div>

    <div class="drawer-side z-20">
      <label for="nav-drawer" class="drawer-overlay" aria-label="Close navigation" />
      <aside class="bg-neutral text-neutral-content flex min-h-full w-64 flex-col gap-6 p-4">
        <div class="flex items-center gap-2 px-2 pt-2">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="#3fa27d" />
            <path d="M7 19l5-5 3 3 6-7" fill="none" stroke="#17221d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="text-xl font-semibold">Tally</span>
        </div>

        <ul class="menu w-full gap-1 p-0">
          <li v-for="l in links" :key="l.to">
            <NuxtLink :to="l.to" :class="{ 'menu-active': l.match(route.path) }" :aria-current="l.match(route.path) ? 'page' : undefined">
              {{ l.label }}
            </NuxtLink>
          </li>
        </ul>

        <div v-if="household" class="border-neutral-content/20 rounded-box border px-3 py-2 text-sm">
          <div class="truncate font-medium">{{ household.name }}</div>
          <div class="text-neutral-content/70 text-xs">
            {{ ROLE_LABEL[household.role] }}{{ household.members.length > 1 ? ` · ${household.members.length} people` : '' }}
          </div>
        </div>

        <div class="px-2">
          <div class="text-neutral-content/60 mb-2 text-xs tracking-wider uppercase">Coming next</div>
          <ul class="text-neutral-content/60 space-y-2 text-sm">
            <li>Goals</li>
          </ul>
        </div>

        <div class="mt-auto flex flex-col gap-1 px-2 text-sm">
          <span class="text-neutral-content/60 truncate">{{ user?.email }}</span>
          <button class="link text-left" @click="signOut">Sign out</button>
        </div>
      </aside>
    </div>

    <div class="toast toast-end z-50" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="alert" :class="t.type === 'success' ? 'alert-success' : 'alert-error'">
        <span>{{ t.text }}</span>
      </div>
    </div>
  </div>
</template>
