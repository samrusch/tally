<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    values: number[]
    color?: string
    width?: number
    height?: number
  }>(),
  { color: '#2f9e76', width: 88, height: 28 },
)

const path = computed(() => {
  const v = props.values
  if (v.length < 2) return ''
  const min = Math.min(...v)
  const max = Math.max(...v)
  const span = max - min || 1
  return v
    .map((n, i) => {
      const x = 2 + ((props.width - 4) * i) / (v.length - 1)
      const y = props.height - 3 - ((props.height - 6) * (n - min)) / span
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
})
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true" class="block">
    <path :d="path" fill="none" :stroke="color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
