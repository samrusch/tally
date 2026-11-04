<script setup lang="ts">
// Landing page for the emailed sign-in link. The Supabase module exchanges the
// token in the URL for a session; as soon as a user appears we move on.
definePageMeta({ layout: 'blank' })
useHead({ title: 'Signing in · Tally' })

const user = useSupabaseUser()
const timedOut = ref(false)

watch(user, (u) => u && navigateTo('/'), { immediate: true })
onMounted(() => setTimeout(() => (timedOut.value = true), 8000))
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
    <template v-if="!timedOut">
      <span class="loading loading-spinner loading-lg text-primary" />
      <p>Signing you in…</p>
    </template>
    <template v-else>
      <p>That sign-in link didn't work. It may have expired.</p>
      <NuxtLink to="/login" class="btn btn-primary">Back to sign in</NuxtLink>
    </template>
  </main>
</template>
