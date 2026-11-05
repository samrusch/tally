<script setup lang="ts">
import type { LineSeries } from '~/types'
import type { EquityRow } from '~/utils/finance'

useHead({ title: 'Dashboard · Tally' })

const { accounts, entries, idx, pending, error } = useLedger()
const { canAdd } = useHousehold()

const range = ref<6 | 12 | 24>(12)
const today = new Date()

const points = computed(() => monthEndPoints(range.value, today))
const series = computed(() => netWorthSeries(accounts.value, idx.value, points.value).filter((p) => p.hasData))
const current = computed(() => snapshotAt(accounts.value, idx.value))
const lastMonthEnd = computed(() => {
  const d = new Date(today.getFullYear(), today.getMonth(), 0)
  return { date: toISODate(d), label: monthLabel(d) }
})
const previous = computed(() => {
  const has = accounts.value.some((a) => entryAt(idx.value, a.id, lastMonthEnd.value.date))
  return has ? snapshotAt(accounts.value, idx.value, lastMonthEnd.value.date) : null
})

function vsLast(now: number, before: number | undefined) {
  if (before === undefined) return undefined
  const diff = now - before
  return `${signedMoney(diff)} vs ${lastMonthEnd.value.label}`
}

const latestEntryDate = computed(() => entries.value.reduce((m, e) => (e.entry_date > m ? e.entry_date : m), ''))
const asOf = computed(() => (latestEntryDate.value ? `Latest balance entered ${fmtDate(latestEntryDate.value)}` : 'No balances yet'))

// Net worth chart
const netWorthSeriesData = computed<LineSeries[]>(() => [
  { label: 'Net worth', data: series.value.map((p) => p.net), color: PALETTE.green },
])
const netWorthLabels = computed(() => series.value.map((p) => p.label))

// Debt payoff chart: history plus a straight-line projection
const payoff = computed(() => projectPayoff(accounts.value, idx.value, today))
const hasLoans = computed(() => accounts.value.some((a) => isDebt(a.type) && a.type !== 'mortgage'))
const debtChart = computed(() => {
  const hist = netWorthSeries(accounts.value, idx.value, monthEndPoints(12, today)).filter((p) => p.hasData)
  const labels = hist.map((p) => monthLabel(parseISO(p.date), true))
  const actual: (number | null)[] = hist.map((p) => p.nonMortgageDebt)
  const projected: (number | null)[] = hist.map(() => null)
  const lastValue = hist[hist.length - 1]?.nonMortgageDebt
  const p = payoff.value
  let showProjection = false
  if (lastValue !== undefined && p.months && p.monthlyPace > 0) {
    showProjection = true
    projected[projected.length - 1] = lastValue
    const horizon = Math.min(p.months, 36)
    for (let k = 1; k <= horizon; k++) {
      labels.push(monthLabel(addMonths(today, k), true))
      actual.push(null)
      projected.push(Math.max(0, lastValue - p.monthlyPace * k))
    }
  }
  const lines: LineSeries[] = [{ label: 'Actual', data: actual, color: PALETTE.orange }]
  if (showProjection) {
    lines.push({ label: 'Projected', data: projected, color: PALETTE.orange, dashed: true })
  }
  return { labels, lines }
})

// Contributions chart
const contribPoints = computed(() => monthEndPoints(12, today))
const contributions = computed(() => monthlyContributions(accounts.value, entries.value, contribPoints.value))
const hasContributions = computed(() => contributions.value.some((v) => v > 0))
const contributionAvg = computed(() => {
  const active = contributions.value.filter((v) => v > 0)
  return active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0
})

// Allocation, equity, insights
const slices = computed(() => allocation(accounts.value, idx.value))
const equity = computed(() => equityRows(accounts.value, idx.value))
const insights = computed(() => buildInsights(accounts.value, idx.value, today))
const equityThen = computed(() => {
  const limit = toISODate(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()))
  return equityRows(accounts.value, idx.value, limit)
})
function equityChange(row: EquityRow) {
  const then = equityThen.value.find((r) => r.asset.id === row.asset.id)
  return then ? row.equity - then.equity : null
}

const toneClass = { good: 'badge-success', warn: 'badge-warning', info: 'badge-info' } as const
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p class="text-base-content/70 text-sm">{{ asOf }}</p>
      </div>
      <NuxtLink to="/accounts" class="btn btn-primary">Update balances</NuxtLink>
    </header>

    <div v-if="pending && !accounts.length" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>Could not load your data: {{ error.message }}</span>
    </div>

    <div v-else-if="!accounts.length" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 py-16 text-center">
        <h2 class="card-title">{{ canAdd ? 'Add your first account' : 'No accounts yet' }}</h2>
        <p class="text-base-content/70 max-w-md">
          {{ canAdd
            ? 'Start with a checking or savings account, then add your debts, investments, home and vehicle. Each balance you log becomes a point on your charts.'
            : 'Nothing has been added yet. The dashboard fills in once someone with access adds accounts.' }}
        </p>
        <NuxtLink v-if="canAdd" to="/accounts" class="btn btn-primary mt-2">Go to accounts</NuxtLink>
      </div>
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Net worth"
          :value="money(current.net)"
          :sub="vsLast(current.net, previous?.net)"
          :tone="previous && current.net >= previous.net ? 'good' : previous ? 'bad' : 'neutral'"
        />
        <StatCard
          label="Total assets"
          :value="money(current.assets)"
          :sub="vsLast(current.assets, previous?.assets)"
          :tone="previous && current.assets >= previous.assets ? 'good' : previous ? 'bad' : 'neutral'"
        />
        <StatCard
          label="Total debt"
          :value="money(current.debts)"
          :sub="
            previous
              ? `${signedMoney(current.debts - previous.debts)} vs ${lastMonthEnd.label}`
              : undefined
          "
          :tone="previous && current.debts > previous.debts ? 'bad' : previous ? 'good' : 'debt'"
        />
        <StatCard
          label="Avg. monthly deposits"
          :value="hasContributions ? money(contributionAvg) : '—'"
          :sub="hasContributions ? 'Logged in the last 12 months' : 'Log deposits when you update a balance'"
        />
      </div>

      <!-- Net worth -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Net worth over time">
        <div class="card-body gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">Net worth</h2>
              <p class="text-base-content/70 text-sm">Assets minus debts, at each month-end</p>
            </div>
            <div class="join" role="group" aria-label="Chart range">
              <button
                v-for="r in [6, 12, 24] as const"
                :key="r"
                class="btn btn-sm join-item"
                :class="{ 'btn-active btn-primary': range === r }"
                :aria-pressed="range === r"
                @click="range = r"
              >
                {{ r }}M
              </button>
            </div>
          </div>
          <LineChart
            v-if="series.length > 1"
            :labels="netWorthLabels"
            :series="netWorthSeriesData"
            description="Net worth line chart"
          />
          <p v-else class="text-base-content/70 py-10 text-center text-sm">
            Add a balance update in a later month and your net worth line will draw itself.
          </p>
        </div>
      </section>

      <!-- Equity -->
      <div v-if="equity.length" class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section v-for="row in equity" :key="row.asset.id" class="card border-base-300 bg-base-100 border" :aria-label="`${row.asset.name} equity`">
          <div class="card-body gap-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">{{ row.asset.name }} equity</h2>
                <p class="text-base-content/70 text-sm">
                  Estimated value minus {{ row.loan ? row.loan.name.toLowerCase() : 'any loan' }}
                </p>
              </div>
              <NuxtLink :to="`/accounts/${row.asset.id}`" class="btn btn-sm btn-ghost">Details</NuxtLink>
            </div>
            <div class="num text-3xl font-medium tracking-tight">{{ money(row.equity) }}</div>
            <progress class="progress progress-primary w-full" :value="Math.max(0, row.share * 100)" max="100" :aria-label="`${pct(row.share)} of value is equity`" />
            <div class="text-base-content/70 flex flex-wrap justify-between gap-2 text-sm">
              <span>Equity · {{ pct(row.share, 0) }} of value</span>
              <span v-if="row.loan">{{ row.loan.name }} {{ money(row.owed) }}</span>
              <span v-else>No loan linked</span>
            </div>
            <div class="border-base-300 text-base-content/70 flex flex-col gap-1 border-t pt-3 text-sm">
              <span>Est. value {{ money(row.value) }}</span>
              <span v-if="equityChange(row) !== null" :class="(equityChange(row) ?? 0) >= 0 ? 'text-success' : 'text-error'">
                {{ signedMoney(equityChange(row) ?? 0) }} equity in 12 months
              </span>
            </div>
          </div>
        </section>
      </div>

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <!-- Debt payoff -->
        <section v-if="hasLoans" class="card border-base-300 bg-base-100 border lg:col-span-3" aria-label="Debt payoff">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">Debt payoff</h2>
                <p class="text-base-content/70 text-sm">Cards and loans (mortgage excluded), with a projection at your recent pace</p>
              </div>
              <span v-if="payoff.total <= 0" class="badge badge-success">Debt-free</span>
              <span v-else-if="payoff.date" class="badge badge-warning">Debt-free ≈ {{ monthYear(payoff.date) }}</span>
            </div>
            <LineChart
              :labels="debtChart.labels"
              :series="debtChart.lines"
              :height="240"
              description="Non-mortgage debt over time with projected payoff"
            />
            <p class="text-base-content/70 text-xs">
              Simple projection: it assumes you keep paying down about {{ money(Math.max(0, payoff.monthlyPace)) }} a month and
              ignores interest.
            </p>
          </div>
        </section>

        <!-- Allocation -->
        <section class="card border-base-300 bg-base-100 border" :class="hasLoans ? 'lg:col-span-2' : 'lg:col-span-5'" aria-label="Where your assets are">
          <div class="card-body gap-4">
            <div>
              <h2 class="font-semibold">Where your assets are</h2>
              <p class="text-base-content/70 text-sm">{{ money(current.assets) }} across {{ slices.length }} {{ slices.length === 1 ? 'type' : 'types' }}</p>
            </div>
            <div class="flex h-4 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              <div v-for="s in slices" :key="s.name" :style="{ flex: `${s.share} 1 0`, background: s.color }" />
            </div>
            <ul class="flex flex-col gap-3 text-sm">
              <li v-for="s in slices" :key="s.name" class="flex items-center gap-2">
                <span class="size-3 shrink-0 rounded-sm" :style="{ background: s.color }" aria-hidden="true" />
                <span class="flex-1">{{ s.name }}</span>
                <span class="num">{{ money(s.amount) }}</span>
                <span class="num text-base-content/70 w-14 text-right">{{ pct(s.share) }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <!-- Contributions -->
        <section class="card border-base-300 bg-base-100 border lg:col-span-3" aria-label="Deposits by month">
          <div class="card-body gap-3">
            <div>
              <h2 class="font-semibold">Deposits by month</h2>
              <p class="text-base-content/70 text-sm">What you added to savings, investments and retirement</p>
            </div>
            <BarChart
              v-if="hasContributions"
              :labels="contribPoints.map((p) => p.label)"
              :data="contributions"
              :color="PALETTE.green"
              series-label="Deposits"
              description="Monthly deposits bar chart"
            />
            <p v-else class="text-base-content/70 py-10 text-center text-sm">
              Enter “deposits since last update” on a savings, investment or retirement account and they'll show up here.
            </p>
          </div>
        </section>

        <!-- Insights -->
        <section class="card border-base-300 bg-base-100 border lg:col-span-2" aria-label="Insights">
          <div class="card-body gap-1">
            <h2 class="font-semibold">Insights</h2>
            <p class="text-base-content/70 mb-2 text-sm">Generated from your balance history</p>
            <ul class="divide-base-300 divide-y">
              <li v-for="(i, n) in insights" :key="n" class="flex flex-col items-start gap-2 py-3 first:pt-0">
                <span class="badge badge-sm badge-soft" :class="toneClass[i.tone]">{{ i.tag }}</span>
                <p class="text-sm leading-relaxed">{{ i.text }}</p>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
