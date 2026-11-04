<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()
const { toasts } = useToast()

const drawerOpen = ref(false)
watch(() => route.fullPath, () => (drawerOpen.value = false))

const links = [
  { to: '/', label: 'Dashboard', match: (p: string) => p === '/' },
  { to: '/accounts', label: 'Accounts', match: (p: string) => p.startsWith('/accounts') },
]

async function signOut() {
  await supabase.auth.signOut()
  clearNuxtData('ledger')
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
        <slot />
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

        <div class="px-2">
          <div class="text-neutral-content/60 mb-2 text-xs tracking-wider uppercase">Coming next</div>
          <ul class="text-neutral-content/60 space-y-2 text-sm">
            <li>Budget</li>
            <li>Goals</li>
            <li>Debt planner</li>
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
