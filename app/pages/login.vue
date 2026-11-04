<script setup lang="ts">
definePageMeta({ layout: 'blank' })
useHead({ title: 'Sign in · Tally' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()

watch(user, (u) => u && navigateTo('/'), { immediate: true })

const email = ref('')
const password = ref('')
const busy = ref(false)
const message = ref<{ type: 'error' | 'success'; text: string } | null>(null)

async function signIn() {
  busy.value = true
  message.value = null
  const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
  busy.value = false
  if (error) message.value = { type: 'error', text: error.message }
  else await navigateTo('/')
}

async function sendLink() {
  if (!email.value.trim()) {
    message.value = { type: 'error', text: 'Enter your email first.' }
    return
  }
  busy.value = true
  message.value = null
  const { error } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    // Only the account you created in Supabase can sign in; this never creates new users.
    options: { emailRedirectTo: `${window.location.origin}/confirm`, shouldCreateUser: false },
  })
  busy.value = false
  message.value = error
    ? { type: 'error', text: error.message }
    : { type: 'success', text: 'Check your email for a sign-in link.' }
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-2">
    <div class="bg-neutral text-neutral-content hidden flex-col justify-between p-14 lg:flex">
      <div class="flex items-center gap-2">
        <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
          <rect width="28" height="28" rx="7" fill="#3fa27d" />
          <path d="M7 19l5-5 3 3 6-7" fill="none" stroke="#17221d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="text-2xl font-semibold">Tally</span>
      </div>
      <div>
        <h1 class="max-w-md text-4xl leading-tight font-semibold tracking-tight">
          Know where you stand, and how fast you're moving.
        </h1>
        <p class="text-neutral-content/70 mt-4 max-w-md">
          Log your balances, watch your savings grow, and see the day your debts hit zero.
        </p>
      </div>
      <div />
    </div>

    <main class="flex items-center justify-center p-6">
      <form class="flex w-full max-w-sm flex-col gap-4" @submit.prevent="signIn">
        <div>
          <h2 class="text-2xl font-semibold">Sign in</h2>
          <p class="text-base-content/70 mt-1 text-sm">Private app. Only your account can get in.</p>
        </div>

        <fieldset class="fieldset">
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" type="email" autocomplete="email" class="input w-full" required placeholder="you@example.com" />
        </fieldset>
        <fieldset class="fieldset">
          <label class="label" for="password">Password</label>
          <input id="password" v-model="password" type="password" autocomplete="current-password" class="input w-full" placeholder="Your password" />
        </fieldset>

        <div v-if="message" role="alert" class="alert" :class="message.type === 'error' ? 'alert-error' : 'alert-success'">
          <span>{{ message.text }}</span>
        </div>

        <button type="submit" class="btn btn-primary" :disabled="busy || !password">
          <span v-if="busy" class="loading loading-spinner loading-sm" />
          Sign in
        </button>
        <div class="divider my-0 text-xs">or</div>
        <button type="button" class="btn" :disabled="busy" @click="sendLink">Email me a sign-in link</button>
      </form>
    </main>
  </div>
</template>
