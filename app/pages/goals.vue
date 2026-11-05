<script setup lang="ts">
import type { Goal, LineSeries } from '~/types'
import type { GoalPlan } from '~/utils/goals'

useHead({ title: 'Goals · Tally' })

const supabase = useSupabaseClient()
const toast = useToast()
const { canAdd, canModify } = useHousehold()
const { allAccounts } = useLedger()
const { plans, today, pending, error } = useGoalPlans()
const { summary: budget } = useBudgetSummary()

const form = ref<{ open: (t: { kind: Goal['kind']; row?: Goal }) => void }>()

const active = computed(() => plans.value.filter((p) => p.goal.active))
const accountName = computed(() => new Map(allAccounts.value.map((a) => [a.id, a.name])))

/* ------------------------------ Summary ------------------------------ */

const needed = computed(() =>
  active.value.reduce((s, p) => s + (p.reached || p.required === null ? 0 : p.required), 0),
)
const planned = computed(() => active.value.reduce((s, p) => s + p.planned, 0))
const onTrackCount = computed(() => active.value.filter((p) => p.onTrack).length)
// What the budget could put toward goals: planned savings plus whatever is still unassigned.
const room = computed(() => budget.value.savings + Math.max(0, budget.value.left))

/* ------------------------------ Cards -------------------------------- */

const when = (d: Date | null) => (d ? monthYear(d) : '')

function status(p: GoalPlan): { label: string; cls: string } {
  if (!p.goal.active) return { label: 'Paused', cls: 'badge-ghost' }
  if (p.reached) return { label: 'Reached', cls: 'badge-success' }
  if (p.onTrack) return { label: 'On track', cls: 'badge-success' }
  if (p.required === null) return { label: 'Date passed', cls: 'badge-error' }
  return { label: 'Behind', cls: 'badge-warning' }
}

function headline(p: GoalPlan): string {
  const g = p.goal
  if (g.kind === 'retirement') {
    const spend = g.annual_spending ?? 0
    return `Nest egg needed ${money(p.target)} (${money(spend)} a year at a ${g.withdrawal_rate}% withdrawal rate)`
  }
  const range = p.low !== null ? ` (range ${money(p.low)} to ${money(p.target)})` : ''
  return `${money(p.target)} by ${when(p.deadline)}${range}`
}

function outlook(p: GoalPlan): string {
  const g = p.goal
  if (p.reached) return 'You already have what this goal needs.'
  if (g.kind === 'retirement') {
    const tgt = g.target_age ?? 0
    if (p.reachedAge === null) return `At ${money(p.planned)} a month you don't reach the nest egg within 50 years.`
    const diff = p.reachedAge - tgt
    const when2 = `age ${p.reachedAge.toFixed(1)}`
    if (Math.abs(diff) < 0.1) return `At this pace you reach it right around age ${tgt}.`
    return diff > 0
      ? `At this pace you reach it at ${when2}, about ${diff.toFixed(1)} years after age ${tgt}.`
      : `At this pace you reach it at ${when2}, about ${Math.abs(diff).toFixed(1)} years before age ${tgt}.`
  }
  if (p.required === null) return `The date has passed and you are ${money(p.target - p.current)} short.`
  if (p.onTrack) {
    return `At ${money(p.planned)} a month you'd have about ${money(p.projected)} by ${when(p.deadline)}, ahead of the ${money(p.target)} target.`
  }
  return `At ${money(p.planned)} a month you'd have about ${money(p.projected)} by ${when(p.deadline)}, ${money(p.gap)} short.`
}

const toGo = (p: GoalPlan) => (p.required === null || p.reached ? 0 : Math.max(0, p.required - p.planned))

/* ------------------------------ Chart -------------------------------- */

const selectedId = ref<string | null>(null)
const selected = computed(() => plans.value.find((p) => p.goal.id === selectedId.value) ?? active.value[0] ?? null)

const chart = computed(() => {
  const p = selected.value
  if (!p) return null
  const g = p.goal
  const cap = 600
  const horizon = Math.min(cap, Math.max(12, g.kind === 'retirement' ? Math.max(p.monthsLeft, p.reachedIn ?? 0) : p.monthsLeft))
  const step = horizon > 240 ? 12 : horizon > 96 ? 6 : horizon > 36 ? 3 : 1
  const points: number[] = []
  for (let m = 0; m <= horizon; m += step) points.push(m)
  if (points[points.length - 1] !== horizon) points.push(horizon)
  const plan = balanceSeries(p.current, p.planned, g.expected_return, horizon)
  const series: LineSeries[] = [
    { label: 'Your plan', data: points.map((m) => Math.round(plan[m] ?? 0)), color: PALETTE.green },
  ]
  if (p.required !== null && !p.reached && p.required > p.planned + 0.5) {
    const need = balanceSeries(p.current, p.required, g.expected_return, p.monthsLeft)
    series.push({
      label: 'Pace needed',
      data: points.map((m) => (m <= p.monthsLeft ? Math.round(need[m] ?? 0) : null)),
      color: PALETTE.orange,
    })
  }
  series.push({ label: 'Target', data: points.map(() => Math.round(p.target)), color: PALETTE.gray, dashed: true })
  return { labels: points.map((m) => monthLabel(addMonths(today, m), true)), series }
})

/* ------------------------------ Actions ------------------------------ */

async function remove(g: Goal) {
  if (!confirm(`Delete the goal "${g.name}"?`)) return
  const { data, error: err } = await supabase.from('goals').delete().eq('id', g.id).select('id')
  if (err) return toast.error(friendlyError(err))
  if (!data?.length) return toast.error(friendlyError('permission denied'))
  toast.success('Goal deleted')
  await refreshNuxtData('goals')
}
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Goals</h1>
        <p class="text-base-content/70 text-sm">What you're saving toward, and whether you're on pace to get there.</p>
      </div>
      <div v-if="canAdd" class="flex flex-wrap gap-2">
        <button class="btn btn-primary" @click="form?.open({ kind: 'target' })">Add savings goal</button>
        <button class="btn btn-outline" @click="form?.open({ kind: 'retirement' })">Add retirement goal</button>
      </div>
    </header>

    <div v-if="pending" class="flex justify-center py-24"><span class="loading loading-spinner loading-lg text-primary" /></div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>
        Could not load goals: {{ error.message }}. If you just upgraded, run the latest <code>supabase/schema.sql</code> in the SQL Editor.
      </span>
    </div>

    <div v-else-if="!plans.length" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 py-14 text-center">
        <h2 class="card-title">{{ canAdd ? 'Set your first goal' : 'No goals yet' }}</h2>
        <p class="text-base-content/70 max-w-md">
          {{ canAdd
            ? 'A savings goal has an amount and a date, like a remodel or a property. A retirement goal works out the nest egg you need and the age you could reach it.'
            : 'Nothing has been added yet. Goals show up here once someone with access adds them.' }}
        </p>
        <div v-if="canAdd" class="mt-2 flex flex-wrap justify-center gap-2">
          <button class="btn btn-primary" @click="form?.open({ kind: 'target' })">Add savings goal</button>
          <button class="btn btn-outline" @click="form?.open({ kind: 'retirement' })">Add retirement goal</button>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Summary -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Goals on track" :value="`${onTrackCount} of ${active.length}`" :tone="onTrackCount === active.length ? 'good' : 'neutral'" />
        <StatCard label="Needed each month" :value="money(needed)" sub="To hit every goal on its date" />
        <StatCard label="Planned each month" :value="money(planned)" :tone="planned + 0.5 >= needed ? 'good' : 'bad'" :sub="planned + 0.5 >= needed ? 'Covers what is needed' : `${money(needed - planned)} short of what is needed`" />
        <StatCard
          label="Budget room"
          :value="budget.income > 0 ? money(room) : '–'"
          :sub="budget.income > 0 ? 'Planned savings plus left to assign' : 'Add income on the Budget page'"
        />
      </div>
      <p v-if="budget.income > 0 && needed > 0" class="text-base-content/70 -mt-2 text-sm">
        <template v-if="needed <= room + 0.5">
          Your budget has room for what the goals need: {{ money(needed) }} a month needed against {{ money(room) }} of savings and unassigned money.
        </template>
        <template v-else>
          The goals need {{ money(needed) }} a month but your budget only has {{ money(room) }} of savings and unassigned money.
          Moving a date out, trimming a target or finding {{ money(needed - room) }} in the <NuxtLink to="/budget" class="link">budget</NuxtLink> would close the gap.
        </template>
      </p>

      <!-- Goal cards -->
      <section class="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Your goals">
        <article
          v-for="p in plans"
          :key="p.goal.id"
          class="card border-base-300 bg-base-100 border"
          :class="{ 'ring-primary ring-2': selected?.goal.id === p.goal.id, 'opacity-60': !p.goal.active }"
        >
          <div class="card-body gap-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate text-lg font-semibold">{{ p.goal.name }}</h2>
                <p class="text-base-content/70 text-sm">{{ headline(p) }}</p>
              </div>
              <span class="badge shrink-0" :class="status(p).cls">{{ status(p).label }}</span>
            </div>

            <div>
              <div class="mb-1 flex justify-between text-sm">
                <span><span class="num font-medium">{{ money(p.current) }}</span> saved</span>
                <span class="text-base-content/70">{{ pct(p.progress, 0) }}</span>
              </div>
              <progress class="progress progress-primary w-full" :value="p.progress * 100" max="100" :aria-label="`${p.goal.name} progress`" />
            </div>

            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-base-content/70">Needed per month</dt>
                <dd class="num font-medium">{{ p.reached ? '$0' : p.required === null ? '–' : money(p.required) }}</dd>
              </div>
              <div>
                <dt class="text-base-content/70">Planned per month</dt>
                <dd class="num font-medium">{{ money(p.planned) }}</dd>
              </div>
              <div v-if="p.goal.kind === 'retirement' && p.ageNow !== null">
                <dt class="text-base-content/70">Years to go</dt>
                <dd class="num font-medium">{{ ((p.goal.target_age ?? 0) - p.ageNow).toFixed(1) }}</dd>
              </div>
              <div v-else>
                <dt class="text-base-content/70">Time left</dt>
                <dd class="num font-medium">{{ p.monthsLeft > 0 ? fmtMonths(p.monthsLeft) : 'None' }}</dd>
              </div>
              <div>
                <dt class="text-base-content/70">Assumed return</dt>
                <dd class="num font-medium">{{ p.goal.expected_return }}%</dd>
              </div>
            </dl>

            <p class="text-sm">{{ outlook(p) }}</p>
            <p v-if="toGo(p) >= 1 && p.goal.active" class="text-warning text-sm">Adding {{ money(toGo(p)) }} a month would put it on track.</p>

            <div v-if="p.goal.linked_account_ids.length" class="flex flex-wrap gap-1">
              <span v-for="id in p.goal.linked_account_ids.filter((x) => accountName.has(x))" :key="id" class="badge badge-outline badge-sm">
                {{ accountName.get(id) }}
              </span>
            </div>
            <p v-if="p.goal.note" class="text-base-content/70 text-xs">{{ p.goal.note }}</p>

            <div class="card-actions mt-1 justify-between">
              <button class="btn btn-sm btn-ghost" @click="selectedId = p.goal.id">Show projection</button>
              <div v-if="canModify(p.goal.created_by)">
                <button class="btn btn-ghost btn-sm" @click="form?.open({ kind: p.goal.kind, row: p.goal })">Edit</button>
                <button class="btn btn-ghost btn-sm text-error" @click="remove(p.goal)">Delete</button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <!-- Projection -->
      <section v-if="selected && chart" class="card border-base-300 bg-base-100 border" aria-label="Projection">
        <div class="card-body gap-3">
          <div>
            <h2 class="font-semibold">{{ selected.goal.name }}: projection</h2>
            <p class="text-base-content/70 text-sm">
              Balance over time if you save {{ money(selected.planned) }} a month at {{ selected.goal.expected_return }}% a year
              <template v-if="selected.goal.kind === 'retirement'">, in today's dollars</template>
            </p>
          </div>
          <LineChart :labels="chart.labels" :series="chart.series" :height="300" :description="`${selected.goal.name} projected balance against its target`" />
        </div>
      </section>

      <p class="text-base-content/70 text-xs">
        These are estimates from the numbers you entered, not predictions. They assume steady monthly saving and a constant return, and ignore taxes and fees.
        For retirement, use a return after inflation so everything stays in today's dollars.
      </p>
    </template>

    <GoalForm ref="form" />
  </div>
</template>
