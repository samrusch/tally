<script setup lang="ts">
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Bar } from 'vue-chartjs'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const props = withDefaults(
  defineProps<{
    labels: string[]
    data: number[]
    color: string
    seriesLabel: string
    height?: number
    /** Plain-language summary for screen readers. */
    description: string
  }>(),
  { height: 220 },
)

const theme = useChartTheme()

const chartData = computed<ChartData<'bar'>>(() => ({
  labels: props.labels,
  datasets: [
    {
      label: props.seriesLabel,
      data: props.data,
      backgroundColor: props.color,
      borderRadius: 4,
      maxBarThickness: 36,
    },
  ],
}))

const chartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => ` ${props.seriesLabel}: ${money(Number(ctx.parsed.y))}` } },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: theme.text, maxRotation: 0 } },
    y: {
      beginAtZero: true,
      grid: { color: theme.grid },
      ticks: { color: theme.text, callback: (v) => compactMoney(Number(v)) },
    },
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }" role="img" :aria-label="description">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
