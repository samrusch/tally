<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import type { LineSeries } from '~/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: LineSeries[]
    height?: number
    /** Plain-language summary for screen readers. */
    description: string
  }>(),
  { height: 280 },
)

const theme = useChartTheme()

const chartData = computed<ChartData<'line'>>(() => ({
  labels: props.labels,
  datasets: props.series.map((s) => ({
    label: s.label,
    data: s.data,
    borderColor: s.color,
    backgroundColor: `${s.color}33`,
    borderWidth: 2.5,
    borderDash: s.dashed ? [6, 5] : [],
    pointRadius: props.labels.length > 24 ? 0 : 3,
    pointHoverRadius: 5,
    pointBackgroundColor: s.color,
    tension: 0.25,
    spanGaps: false,
    fill: s.fillToNext ? '+1' : false,
  })),
}))

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: props.series.length > 1,
      position: 'bottom',
      labels: { color: theme.text, boxWidth: 24, boxHeight: 3, padding: 16 },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => ` ${ctx.dataset.label}: ${money(Number(ctx.parsed.y))}`,
      },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: theme.text, maxRotation: 0, autoSkip: true } },
    y: {
      grid: { color: theme.grid },
      ticks: { color: theme.text, callback: (v) => compactMoney(Number(v)) },
    },
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }" role="img" :aria-label="description">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
