<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string
    sub?: string
    /** Colors the sub line and, for 'debt', the value. */
    tone?: 'good' | 'bad' | 'debt' | 'neutral'
  }>(),
  { tone: 'neutral' },
)
</script>

<template>
  <div class="card border-base-300 bg-base-100 border">
    <div class="card-body gap-1 p-5">
      <div class="text-base-content/70 text-sm">{{ label }}</div>
      <div class="num text-2xl font-medium tracking-tight" :class="{ 'text-error': tone === 'debt' }">
        {{ value }}
      </div>
      <div
        v-if="sub"
        class="text-sm"
        :class="{
          'text-success': tone === 'good',
          'text-error': tone === 'bad',
          'text-base-content/70': tone === 'neutral' || tone === 'debt',
        }"
      >
        {{ sub }}
      </div>
    </div>
  </div>
</template>
