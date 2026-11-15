<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string
    sub?: string
    /** Colors the sub line and, for 'debt', the value. */
    tone?: 'good' | 'bad' | 'debt' | 'neutral'
    /** Optional trend line shown to the right of the value. */
    /** Colors the sub line on its own, so a debt card can show a red value and a green improvement. */
    subTone?: 'good' | 'bad' | 'neutral'
    spark?: number[]
    sparkColor?: string
  }>(),
  { tone: 'neutral' },
)
</script>

<template>
  <div class="card border-base-300 bg-base-100 border">
    <div class="card-body gap-1 p-5">
      <div class="text-base-content/70 text-sm">{{ label }}</div>
      <div class="flex items-center justify-between gap-3">
        <div class="num text-2xl font-medium tracking-tight" :class="{ 'text-error': tone === 'debt' }">
          {{ value }}
        </div>
        <Sparkline v-if="spark && spark.length > 1" :values="spark" :color="sparkColor" :width="96" :height="32" class="shrink-0" />
      </div>
      <div
        v-if="sub"
        class="text-sm"
        :class="{
          'text-success': (subTone ?? tone) === 'good',
          'text-error': (subTone ?? tone) === 'bad',
          'text-base-content/70': (subTone ?? tone) === 'neutral' || (subTone ?? tone) === 'debt',
        }"
      >
        {{ sub }}
      </div>
    </div>
  </div>
</template>
