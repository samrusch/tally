<script setup lang="ts">
import type { CashEvent } from '~/utils/cashflow'

useHead({ title: 'Cash flow · Tally' })

const { accounts, subscriptions, idx, pending: ledgerPending, error: ledgerError } = useLedger()
const { income, items, pending: budgetPending, error: budgetError } = useBudget()
const { canAdd } = useHousehold()

const pending = computed(() => ledgerPending.value || budgetPending.value)
const error = computed(() => ledgerError.value ?? budgetError.value)

const today = todayISO()
const monthStart = ref(addMonths(new Date(), 0))
const isThisMonth = computed(() => toISODate(monthStart.value).slice(0, 7) === today.slice(0, 7))
const shift = (n: number) => (monthStart.value = addMonths(monthStart.value, n))
const goToday = () => (monthStart.value = addMonths(new Date(), 0))

const monthEnd = computed(() => new Date(monthStart.value.getFullYear(), monthStart.value.getMonth() + 1, 0))
const events = computed(() => cashEvents(accounts.value, idx.value, income.value, monthStart.value, monthEnd.value, items.value, subscriptions.value))

// Cash projection: start from today's checking balance and apply every dated event up to the end of the month shown.
const hasChecking = computed(() => accounts.value.some((a) => a.type === 'checking'))
const startCash = computed(() => cashOnHand(accounts.value, idx.value))
const projection = computed(() => {
  if (!hasChecking.value || toISODate(monthEnd.value) < today) return null
  const upTo = cashEvents(accounts.value, idx.value, income.value, parseISO(today), monthEnd.value, items.value, subscriptions.value)
  return projectCash(startCash.value, upTo, today)
})
const balanceOn = (date: string) => projection.value?.endOfDay.get(date) ?? null
const totals = computed(() => totalsOf(events.value))
const gaps = computed(() => missingDates(accounts.value, idx.value, income.value, subscriptions.value))
const hasGaps = computed(() => gaps.value.income.length > 0 || gaps.value.debts.length > 0 || gaps.value.subscriptions.length > 0)

const byDate = computed(() => {
  const m = new Map<string, CashEvent[]>()
  for (const e of events.value) m.set(e.date, [...(m.get(e.date) ?? []), e])
  return m
})

/** Weeks of seven cells starting on Sunday; days outside the month are null. */
const weeks = computed(() => {
  const y = monthStart.value.getFullYear()
  const m = monthStart.value.getMonth()
  const lead = new Date(y, m, 1).getDay()
  const days = monthEnd.value.getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => toISODate(new Date(y, m, i + 1))),
  ]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
})

const CHIP: Record<CashEvent['kind'], string> = {
  income: 'bg-success/30 border-success text-base-content',
  debt: 'bg-warning/35 border-warning text-base-content',
  bill: 'bg-info/30 border-info text-base-content',
}
const DOT: Record<CashEvent['kind'], string> = { income: 'bg-success', debt: 'bg-warning', bill: 'bg-info' }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const signed = (e: CashEvent) =>
  e.amount === null ? 'No minimum' : (e.kind === 'income' ? '+' : '−') + money(e.amount)

/** The list of days with activity, each with the month's running net up to the end of that day. */
const schedule = computed(() => {
  let running = 0
  return [...byDate.value.entries()].map(([date, list]) => {
    for (const e of list) running += e.kind === 'income' ? (e.amount ?? 0) : -(e.amount ?? 0)
    return { date, list, running, balance: balanceOn(date) }
  })
})

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(parseISO(iso))
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Cash flow</h1>
        <p class="text-base-content/70 text-sm">When money comes in and when your debt payments are due.</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-sm btn-square" aria-label="Previous month" @click="shift(-1)">‹</button>
        <h2 class="min-w-36 text-center font-semibold" aria-live="polite">{{ monthYear(monthStart) }}</h2>
        <button class="btn btn-sm btn-square" aria-label="Next month" @click="shift(1)">›</button>
        <button class="btn btn-sm" :disabled="isThisMonth" @click="goToday">Today</button>
      </div>
    </header>

    <div v-if="pending" class="flex justify-center py-24"><span class="loading loading-spinner loading-lg text-primary" /></div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>
        Could not load your data: {{ error.message }}. If you just upgraded, run the latest <code>supabase/schema.sql</code> in the SQL Editor.
      </span>
    </div>

    <template v-else>
      <!-- Dates still to add -->
      <div v-if="hasGaps" role="status" class="alert alert-warning items-start text-sm">
        <div class="flex flex-col gap-1">
          <span class="font-medium">Some items aren't on the calendar yet because they have no date.</span>
          <span v-if="gaps.income.length">
            Income, add a pay date on the
            <NuxtLink to="/budget" class="link">Budget</NuxtLink> page:
            {{ gaps.income.map((s) => s.name).join(', ') }}.
          </span>
          <span v-if="gaps.debts.length">
            Debts, add a due day on the account:
            <template v-for="(d, n) in gaps.debts" :key="d.id">
              <NuxtLink :to="`/accounts/${d.id}`" class="link">{{ d.name }}</NuxtLink>{{ n < gaps.debts.length - 1 ? ', ' : '.' }}
            </template>
          </span>
          <span v-if="gaps.subscriptions.length">
            Subscriptions, add a billing date on the <NuxtLink to="/accounts" class="link">Accounts</NuxtLink> page:
            {{ gaps.subscriptions.map((s) => s.name).join(', ') }}.
          </span>
          <span v-if="!canAdd" class="opacity-70">Ask someone with edit access to add them.</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Money in" :value="money(totals.moneyIn)" sub="Paychecks landing this month" />
        <StatCard
          label="Money out"
          :value="money(totals.moneyOut)"
          :sub="totals.unknownPayments ? `Debt payments and bills, plus ${totals.unknownPayments} with no minimum entered` : 'Debt payments and dated bills'"
        />
        <StatCard
          label="Net for the month"
          :value="signedMoney(totals.net)"
          :tone="totals.net < 0 ? 'bad' : 'good'"
          sub="Only what has a date"
        />
        <StatCard
          v-if="projection"
          label="Lowest balance"
          :value="projection.low ? money(projection.low.balance) : money(projection.start)"
          :tone="(projection.low?.balance ?? projection.start) < 0 ? 'bad' : 'neutral'"
          :sub="projection.low ? `${shortDate(projection.low.date)}, starting from ${money(projection.start)} in checking` : `${money(projection.start)} in checking, nothing else scheduled`"
        />
        <StatCard v-else-if="!hasChecking" label="Lowest balance" value="n/a" sub="Add a checking account to project your cash" />
      </div>
      <p v-if="projection" class="text-base-content/60 -mt-3 text-xs">
        The balance only counts items that have a date. Everyday spending with no date, like groceries, isn't included, so expect the real balance to run lower.
      </p>

      <div v-if="!events.length && !hasGaps" class="card border-base-300 bg-base-100 border">
        <div class="card-body items-center gap-2 py-14 text-center">
          <h2 class="card-title">Nothing scheduled</h2>
          <p class="text-base-content/70 max-w-md">
            Add a pay date to your income and due dates to your bills on the Budget page, and a due day to your debts and a billing date to your subscriptions on the Accounts page, and they will show up here.
          </p>
        </div>
      </div>

      <template v-else>
        <!-- Month grid -->
        <section class="card border-base-300 bg-base-100 hidden border sm:block" aria-label="Calendar">
          <div class="card-body gap-2 p-3 sm:p-4">
            <div class="text-base-content/60 grid grid-cols-7 gap-1 text-center text-xs font-medium">
              <div v-for="w in WEEKDAYS" :key="w">{{ w }}</div>
            </div>
            <div v-for="(week, wi) in weeks" :key="wi" class="grid grid-cols-7 gap-1">
              <div
                v-for="(date, di) in week"
                :key="di"
                class="min-h-24 min-w-0 rounded-md border p-1"
                :class="[
                  date ? 'border-base-300' : 'border-transparent',
                  date === today ? 'bg-primary/10 border-primary' : '',
                ]"
              >
                <template v-if="date">
                  <div class="flex items-baseline justify-between gap-1 text-xs" :class="date === today ? 'text-primary font-semibold' : 'text-base-content/60'">
                    <span>{{ Number(date.slice(8)) }}</span>
                    <span v-if="balanceOn(date) !== null" class="num font-normal" :class="(balanceOn(date) ?? 0) < 0 ? 'text-error' : ''" :title="`Balance after this day: ${money(balanceOn(date) ?? 0)}`">
                      {{ compactMoney(balanceOn(date) ?? 0) }}
                    </span>
                  </div>
                  <ul class="mt-1 flex flex-col gap-1">
                    <li
                      v-for="(e, ei) in byDate.get(date) ?? []"
                      :key="ei"
                      class="truncate rounded border-l-4 px-1 py-0.5 text-xs"
                      :class="CHIP[e.kind]"
                      :title="`${e.name}: ${signed(e)}`"
                    >
                      <NuxtLink :to="e.href" class="num font-medium">{{ signed(e) }}</NuxtLink>
                      <span class="ml-1">{{ e.name }}</span>
                    </li>
                  </ul>
                </template>
              </div>
            </div>
            <p class="text-base-content/60 flex gap-4 px-1 pt-1 text-xs">
              <span class="flex items-center gap-1.5"><span class="bg-success/30 border-success size-3 rounded-sm border-l-4" aria-hidden="true" /> Income</span>
              <span class="flex items-center gap-1.5"><span class="bg-warning/35 border-warning size-3 rounded-sm border-l-4" aria-hidden="true" /> Debt payment</span>
              <span class="flex items-center gap-1.5"><span class="bg-info/30 border-info size-3 rounded-sm border-l-4" aria-hidden="true" /> Bill</span>
              <span v-if="projection" class="ml-auto">Small number: balance at the end of the day</span>
            </p>
          </div>
        </section>

        <!-- Day-by-day list: the main view on phones, a readable alternative on wide screens -->
        <section class="card border-base-300 bg-base-100 border" aria-label="Schedule">
          <div class="card-body gap-3">
            <div>
              <h2 class="font-semibold">Schedule</h2>
              <p class="text-base-content/70 text-sm">Day by day, with your projected checking balance after each day</p>
            </div>
            <p v-if="!schedule.length" class="text-base-content/70 text-sm">Nothing is scheduled in {{ monthYear(monthStart) }}.</p>
            <ul v-else class="divide-base-300 divide-y">
              <li v-for="d in schedule" :key="d.date" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium" :class="{ 'text-primary': d.date === today }">
                    {{ dayLabel(d.date) }}<span v-if="d.date === today" class="badge badge-primary badge-sm ml-2">Today</span>
                  </div>
                  <ul class="mt-1 flex flex-col gap-0.5 text-sm">
                    <li v-for="(e, ei) in d.list" :key="ei" class="flex items-center gap-2">
                      <span class="size-2 rounded-full" :class="DOT[e.kind]" aria-hidden="true" />
                      <NuxtLink :to="e.href" class="link link-hover truncate">{{ e.name }}</NuxtLink>
                      <span class="num" :class="e.kind === 'income' ? 'text-success' : ''">{{ signed(e) }}</span>
                    </li>
                  </ul>
                </div>
                <div class="text-right text-xs">
                  <template v-if="d.balance !== null">
                    <div class="text-base-content/60">Balance after</div>
                    <div class="num text-sm font-medium" :class="d.balance < 0 ? 'text-error' : ''">{{ money(d.balance) }}</div>
                  </template>
                  <template v-else>
                    <div class="text-base-content/60">Month so far</div>
                    <div class="num text-sm font-medium" :class="d.running < 0 ? 'text-error' : ''">{{ signedMoney(d.running) }}</div>
                  </template>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
