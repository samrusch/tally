<script setup lang="ts">
import type { LineSeries } from '~/types'

useHead({ title: 'Debt planner · Tally' })

const supabase = useSupabaseClient()
const toast = useToast()
const { accounts, idx, pending, error } = useLedger()
const { canModify } = useHousehold()
const { summary: budget } = useBudgetSummary()

/* ----------------------------- controls ----------------------------------- */

const extra = ref<number | string>(0)
const includeMortgage = ref(false)
const tab = ref<'avalanche' | 'snowball'>('avalanche')

onMounted(() => {
  try {
    const saved = Number(localStorage.getItem('tally.extra'))
    if (Number.isFinite(saved) && saved >= 0) extra.value = saved
  } catch {
    /* storage unavailable: fine */
  }
})
watch(extra, () => {
  try {
    localStorage.setItem('tally.extra', String(extraNum.value))
  } catch {
    /* ignore */
  }
})

const extraNum = computed(() => {
  const n = Number(extra.value)
  return Number.isFinite(n) && n > 0 ? n : 0
})

/* ----------------------------- debts -------------------------------------- */

const inputs = computed(() => debtInputs(accounts.value, idx.value, includeMortgage.value))
const debts = computed(() => prepareDebts(inputs.value))
const flags = computed(() => new Map(debts.value.map((d) => [d.id, d])))
const totalDebt = computed(() => debts.value.reduce((s, d) => s + d.balance, 0))
const totalMin = computed(() => debts.value.reduce((s, d) => s + d.min, 0))
const anyAssumed = computed(() => debts.value.some((d) => d.aprMissing || d.minEstimated))

const today = new Date()
const results = computed(() => ({
  minimum: simulatePayoff(debts.value, 'minimum', 0, today),
  snowball: simulatePayoff(debts.value, 'snowball', extraNum.value, today),
  avalanche: simulatePayoff(debts.value, 'avalanche', extraNum.value, today),
}))

const cards = computed(() => {
  const r = results.value
  const feasible = [r.minimum, r.snowball, r.avalanche].filter((x) => x.feasible)
  const best = feasible.length ? Math.min(...feasible.map((x) => x.totalInterest)) : null
  return [
    { key: 'minimum', title: 'Minimums only', note: 'No extra, no rollover', res: r.minimum },
    { key: 'snowball', title: 'Snowball', note: 'Smallest balance first', res: r.snowball },
    { key: 'avalanche', title: 'Avalanche', note: 'Highest rate first', res: r.avalanche },
  ].map((c) => ({
    ...c,
    best: best !== null && c.res.feasible && Math.abs(c.res.totalInterest - best) < 0.5,
    saved: c.res.feasible && r.minimum.feasible ? r.minimum.totalInterest - c.res.totalInterest : null,
  }))
})

const avalancheVsSnowball = computed(() => {
  const { avalanche: a, snowball: s } = results.value
  if (!a.feasible || !s.feasible) return null
  const diff = s.totalInterest - a.totalInterest
  if (diff < 1) return 'Avalanche and snowball cost about the same here, so pick whichever keeps you motivated.'
  return `Avalanche saves ${money(diff)} in interest over snowball${
    s.months > a.months ? ` and finishes ${s.months - a.months} month${s.months - a.months === 1 ? '' : 's'} sooner` : ''
  }.`
})

/* ----------------------------- chart -------------------------------------- */

const chart = computed(() => {
  const r = results.value
  const horizon = Math.min(
    360,
    Math.max(...[r.minimum, r.snowball, r.avalanche].map((x) => (x.feasible ? x.months : 0)), 12),
  )
  const labels = Array.from({ length: horizon + 1 }, (_, m) => monthLabel(addMonths(today, m), true))
  const line = (balances: number[]) =>
    Array.from({ length: horizon + 1 }, (_, m) => Math.round(balances[m] ?? 0))
  const series: LineSeries[] = [
    { label: 'Minimums only', data: line(r.minimum.balances), color: '#8a8f98', dashed: true },
    { label: 'Snowball', data: line(r.snowball.balances), color: '#3b7dd8' },
    { label: 'Avalanche', data: line(r.avalanche.balances), color: '#2f9e76' },
  ]
  return { labels, series }
})

/* ----------------------------- order table -------------------------------- */

const order = computed(() => results.value[tab.value].perDebt)

/* ----------------------------- inline edits ------------------------------- */

const saving = ref<string | null>(null)

// Rates and minimums belong to the account, so they follow the same rules as editing the account.
const createdBy = computed(() => new Map(accounts.value.map((a) => [a.id, a.created_by])))
const canEdit = (id: string) => canModify(createdBy.value.get(id) ?? null)
const anyLocked = computed(() => inputs.value.some((d) => !canEdit(d.id)))

async function saveField(id: string, field: 'apr' | 'min_payment', ev: Event) {
  const el = ev.target as HTMLInputElement
  const raw = el.value.trim()
  const value = raw === '' ? null : Number(raw)
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    toast.error('Enter zero or a positive number')
    return
  }
  if (field === 'apr' && value !== null && value > 999.999) {
    toast.error('That rate is too large')
    return
  }
  saving.value = id
  const { data, error: err } = await supabase
    .from('accounts')
    .update(field === 'apr' ? { apr: value } : { min_payment: value })
    .eq('id', id)
    .select('id')
  saving.value = null
  if (err || !data?.length) {
    toast.error(friendlyError(err ?? 'permission denied'))
    await refreshNuxtData('ledger')
    return
  }
  toast.success('Saved')
  await refreshNuxtData('ledger')
}

/* ----------------------------- balance transfer --------------------------- */

const xferId = ref('')
const feePct = ref<number | string>(3)
const promoApr = ref<number | string>(0)
const promoMonths = ref<number | string>(15)
const afterApr = ref<number | string>('')
const payment = ref<number | string>('')

const xferChoices = computed(() => debts.value.filter((d) => d.balance > 0))
const xferDebt = computed(() => xferChoices.value.find((d) => d.id === xferId.value) ?? null)

function defaultCard() {
  const cards = inputs.value.filter((d) => d.type === 'credit_card')
  return (cards[0] ?? inputs.value[0])?.id ?? ''
}

watch(
  xferChoices,
  () => {
    if (!xferChoices.value.some((d) => d.id === xferId.value)) xferId.value = defaultCard()
  },
  { immediate: true },
)

// When the chosen debt (or the promo length) changes, reset the dependent defaults.
watch(
  [xferDebt, promoMonths],
  () => {
    const d = xferDebt.value
    if (!d) return
    afterApr.value = d.apr || ''
    const months = Math.max(1, Number(promoMonths.value) || 12)
    payment.value = Math.max(10, Math.ceil(d.balance / months / 10) * 10)
  },
  { immediate: true },
)

const num = (v: unknown, fallback = 0) => {
  const n = Number(v)
  return v === '' || !Number.isFinite(n) || n < 0 ? fallback : n
}

const xfer = computed(() => {
  const d = xferDebt.value
  if (!d) return null
  const pay = num(payment.value)
  if (pay <= 0) return null
  return compareTransfer({
    balance: d.balance,
    currentApr: d.apr,
    afterApr: num(afterApr.value),
    payment: pay,
    feePct: num(feePct.value),
    promoApr: num(promoApr.value),
    promoMonths: Math.max(0, Math.round(num(promoMonths.value))),
  })
})
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header>
      <h1 class="text-2xl font-semibold">Debt planner</h1>
      <p class="text-base-content/70 mt-1 text-sm">
        See when you could be debt-free, what interest it costs, and how much an extra payment each month changes.
      </p>
    </header>

    <div v-if="pending" class="flex justify-center p-12"><span class="loading loading-spinner loading-lg" /></div>
    <div v-else-if="error" class="alert alert-error">Could not load your data: {{ error.message }}</div>

    <div v-else-if="!inputs.length" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 p-10 text-center">
        <h2 class="text-lg font-semibold">No debts to plan yet</h2>
        <p class="text-base-content/70 max-w-md text-sm">
          Add a credit card or loan on the Accounts page, with its interest rate and minimum payment, and the planner will build from it.
        </p>
        <NuxtLink to="/accounts" class="btn btn-primary">Go to accounts</NuxtLink>
      </div>
    </div>

    <template v-else>
      <!-- Controls -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Plan settings">
        <div class="card-body gap-4">
          <div class="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
            <div class="md:col-span-2">
              <label class="label mb-1" for="extra-range">Extra toward debt each month</label>
              <input
                id="extra-range"
                v-model.number="extra"
                type="range"
                min="0"
                max="2000"
                step="25"
                class="range range-primary w-full"
              />
            </div>
            <div>
              <label class="label mb-1" for="extra-num">Amount ($)</label>
              <input
                id="extra-num"
                v-model="extra"
                type="number"
                min="0"
                step="25"
                inputmode="decimal"
                class="input num w-full"
              />
            </div>
          </div>
          <div v-if="budget.income > 0" class="bg-base-200 rounded-box flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <span v-if="budget.availableForExtra >= 1">
              Your <NuxtLink to="/budget" class="link">budget</NuxtLink> leaves
              <span class="num font-medium">{{ money(budget.availableForExtra) }}</span> a month for extra debt payments
              (income minus spending, savings and minimums).
            </span>
            <span v-else>
              Your <NuxtLink to="/budget" class="link">budget</NuxtLink> has nothing left over for extra debt payments yet.
            </span>
            <button v-if="budget.availableForExtra >= 1" type="button" class="btn btn-sm btn-outline" @click="extra = Math.floor(budget.availableForExtra / 25) * 25">
              Use {{ money(Math.floor(budget.availableForExtra / 25) * 25) }} as my extra
            </button>
          </div>
          <p v-else class="text-base-content/70 text-sm">
            Add your income on the <NuxtLink to="/budget" class="link">Budget page</NuxtLink> to see how much you could put toward debt each month.
          </p>
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
            <label class="flex cursor-pointer items-center gap-2">
              <input v-model="includeMortgage" type="checkbox" class="checkbox checkbox-sm" />
              <span>Include mortgage in the plan</span>
            </label>
            <span class="text-base-content/70">
              Total owed <span class="num font-medium">{{ money(totalDebt) }}</span> · minimums
              <span class="num font-medium">{{ money(totalMin) }}</span>/mo · with extra
              <span class="num font-medium">{{ money(totalMin + extraNum) }}</span>/mo
            </span>
          </div>
        </div>
      </section>

      <!-- Debts -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Your debts">
        <div class="card-body gap-3">
          <div>
            <h2 class="font-semibold">Your debts</h2>
            <p class="text-base-content/70 text-sm">
              Edit a rate or minimum and press Enter or tab out to save it to the account.
              <template v-if="anyLocked">Fields that are greyed out belong to accounts you can't change.</template>
            </p>
          </div>
          <div class="overflow-x-auto">
            <table class="table min-w-[34rem]">
              <thead>
                <tr>
                  <th>Debt</th>
                  <th class="text-right">Balance</th>
                  <th class="w-32">APR %</th>
                  <th class="w-36">Min payment</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in inputs" :key="d.id">
                  <td>
                    <NuxtLink :to="`/accounts/${d.id}`" class="link link-hover font-medium">{{ d.name }}</NuxtLink>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <span v-if="flags.get(d.id)?.aprMissing" class="badge badge-warning badge-sm whitespace-nowrap">APR missing: using 0%</span>
                      <span v-if="flags.get(d.id)?.minEstimated" class="badge badge-warning badge-sm whitespace-nowrap">
                        Min estimated: {{ money(flags.get(d.id)?.min ?? 0) }}
                      </span>
                    </div>
                  </td>
                  <td class="num text-right">{{ money(d.balance) }}</td>
                  <td>
                    <input
                      :aria-label="`APR for ${d.name}`"
                      type="number"
                      min="0"
                      step="0.001"
                      inputmode="decimal"
                      class="input input-sm num w-full"
                      :value="d.apr ?? ''"
                      :disabled="saving === d.id || !canEdit(d.id)"
                      placeholder="0"
                      @change="saveField(d.id, 'apr', $event)"
                    />
                  </td>
                  <td>
                    <input
                      :aria-label="`Minimum payment for ${d.name}`"
                      type="number"
                      min="0"
                      step="0.01"
                      inputmode="decimal"
                      class="input input-sm num w-full"
                      :value="d.minPayment ?? ''"
                      :disabled="saving === d.id || !canEdit(d.id)"
                      placeholder="0.00"
                      @change="saveField(d.id, 'min_payment', $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="anyAssumed" class="text-warning text-sm">
            Some numbers are assumed (marked above). Fill them in for an accurate plan.
          </p>
        </div>
      </section>

      <!-- Scenarios -->
      <section aria-label="Strategy comparison" class="flex flex-col gap-3">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div v-for="c in cards" :key="c.key" class="card border-base-300 bg-base-100 border" :class="{ 'border-success': c.best }">
            <div class="card-body gap-1 p-5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="font-semibold">{{ c.title }}</h2>
                <span v-if="c.best" class="badge badge-success badge-sm">Lowest interest</span>
              </div>
              <p class="text-base-content/70 text-xs">{{ c.note }}</p>
              <template v-if="c.res.feasible">
                <div class="num mt-2 text-2xl font-medium">{{ c.res.payoffDate ? monthYear(c.res.payoffDate) : 'Now' }}</div>
                <div class="text-base-content/70 text-sm">debt-free in {{ fmtDuration(c.res.months) }}</div>
                <div class="num mt-2 text-sm">{{ money(c.res.totalInterest) }} <span class="text-base-content/70 font-sans">interest</span></div>
                <div v-if="c.key !== 'minimum' && c.saved !== null && c.saved >= 1" class="text-success text-sm">
                  Saves {{ money(c.saved) }} vs minimums
                </div>
              </template>
              <template v-else>
                <div class="text-error mt-2 text-lg font-medium">Never paid off</div>
                <div class="text-base-content/70 text-sm">Payments don't outrun the interest. Raise the minimums or add extra.</div>
              </template>
            </div>
          </div>
        </div>
        <p v-if="avalancheVsSnowball" class="text-base-content/70 text-sm">{{ avalancheVsSnowball }}</p>
      </section>

      <!-- Chart -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Remaining debt by strategy">
        <div class="card-body gap-3">
          <div>
            <h2 class="font-semibold">Remaining debt</h2>
            <p class="text-base-content/70 text-sm">Total owed month by month under each approach</p>
          </div>
          <LineChart
            :labels="chart.labels"
            :series="chart.series"
            :height="280"
            description="Total remaining debt over time under minimum payments only, snowball and avalanche"
          />
        </div>
      </section>

      <!-- Order -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Payoff order">
        <div class="card-body gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">Payoff order</h2>
              <p class="text-base-content/70 text-sm">When each debt reaches zero and what it costs in interest</p>
            </div>
            <div role="tablist" class="tabs tabs-box">
              <button role="tab" class="tab" :class="{ 'tab-active': tab === 'avalanche' }" @click="tab = 'avalanche'">Avalanche</button>
              <button role="tab" class="tab" :class="{ 'tab-active': tab === 'snowball' }" @click="tab = 'snowball'">Snowball</button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Debt</th>
                  <th class="text-right">APR</th>
                  <th>Paid off</th>
                  <th class="text-right">Interest</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(o, i) in order" :key="o.id">
                  <td>{{ i + 1 }}</td>
                  <td class="font-medium">{{ o.name }}</td>
                  <td class="num text-right">{{ o.apr }}%</td>
                  <td>
                    <template v-if="o.paidOffMonth">
                      {{ monthYear(addMonths(today, o.paidOffMonth)) }}
                      <span class="text-base-content/70 text-xs">({{ fmtDuration(o.paidOffMonth) }})</span>
                    </template>
                    <span v-else class="text-error">Never</span>
                  </td>
                  <td class="num text-right">{{ money(o.interest) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Balance transfer -->
      <section class="card border-base-300 bg-base-100 border" aria-label="Balance transfer calculator">
        <div class="card-body gap-4">
          <div>
            <h2 class="font-semibold">Balance transfer calculator</h2>
            <p class="text-base-content/70 text-sm">
              Would moving a balance to a promotional card save money? Enter the offer's terms to compare.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <fieldset class="fieldset col-span-2 md:col-span-3 lg:col-span-2">
              <label class="label" for="x-debt">Debt to move</label>
              <select id="x-debt" v-model="xferId" class="select w-full">
                <option v-for="d in xferChoices" :key="d.id" :value="d.id">{{ d.name }} ({{ money(d.balance) }})</option>
              </select>
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="x-fee">Fee %</label>
              <input id="x-fee" v-model="feePct" type="number" min="0" step="0.1" class="input num w-full" />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="x-promo">Promo APR %</label>
              <input id="x-promo" v-model="promoApr" type="number" min="0" step="0.1" class="input num w-full" />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="x-months">Promo months</label>
              <input id="x-months" v-model="promoMonths" type="number" min="0" step="1" class="input num w-full" />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="x-after">APR after promo %</label>
              <input id="x-after" v-model="afterApr" type="number" min="0" step="0.1" class="input num w-full" />
            </fieldset>
            <fieldset class="fieldset col-span-2 md:col-span-1">
              <label class="label" for="x-pay">Monthly payment ($)</label>
              <input id="x-pay" v-model="payment" type="number" min="0" step="5" class="input num w-full" />
            </fieldset>
          </div>

          <div v-if="xfer && xferDebt" class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="border-base-300 rounded-box border p-4">
              <h3 class="text-sm font-semibold">Stay where it is</h3>
              <template v-if="xfer.stay.feasible">
                <div class="num mt-1 text-xl">{{ money(xfer.stay.interest) }} <span class="text-base-content/70 font-sans text-sm">interest</span></div>
                <div class="text-base-content/70 text-sm">paid off in {{ fmtDuration(xfer.stay.months ?? 0) }}</div>
              </template>
              <div v-else class="text-error mt-1 text-sm">This payment never pays it off at the current rate.</div>
            </div>
            <div class="border-base-300 rounded-box border p-4">
              <h3 class="text-sm font-semibold">Transfer to the promo card</h3>
              <template v-if="xfer.move.feasible">
                <div class="num mt-1 text-xl">
                  {{ money(xfer.move.interest + xfer.move.fee) }}
                  <span class="text-base-content/70 font-sans text-sm">interest + fee</span>
                </div>
                <div class="text-base-content/70 text-sm">
                  fee {{ money(xfer.move.fee) }} · paid off in {{ fmtDuration(xfer.move.months ?? 0) }}
                </div>
              </template>
              <div v-else class="text-error mt-1 text-sm">This payment never pays it off after the promo ends.</div>
              <div v-if="xfer.move.balanceAfterPromo !== null && num(promoMonths) > 0" class="text-base-content/70 mt-1 text-sm">
                Balance when the promo ends: <span class="num">{{ money(xfer.move.balanceAfterPromo) }}</span>
              </div>
            </div>
          </div>
          <div v-if="xfer && xfer.netSavings !== null" class="alert" :class="xfer.netSavings > 0 ? 'alert-success' : 'alert-warning'">
            <span v-if="xfer.netSavings > 0">The transfer would save about {{ money(xfer.netSavings) }} after the fee.</span>
            <span v-else>The transfer would cost about {{ money(Math.abs(xfer.netSavings)) }} more than staying put.</span>
          </div>
          <p class="text-base-content/70 text-xs">
            Estimate only. It assumes the same monthly payment either way and no new purchases. Check the offer's terms: some
            issuers charge interest retroactively if the promo balance isn't cleared in time, and a new card can affect your credit.
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
