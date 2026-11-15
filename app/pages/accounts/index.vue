<script setup lang="ts">
import type { Account } from '~/types'

useHead({ title: 'Accounts · Tally' })

const { accounts, allAccounts, subscriptions, allSubscriptions, idx, pending, error } = useLedger()
const { canAdd, canModify } = useHousehold()
const supabase = useSupabaseClient()
const toast = useToast()
const form = ref<{ open: (a?: Account) => void }>()
const showArchived = ref(false)

const visible = computed(() => (showArchived.value ? allAccounts.value : accounts.value))
const archivedCount = computed(
  () => allAccounts.value.filter((a) => a.archived).length + allSubscriptions.value.filter((a) => a.archived).length,
)

const visibleSubs = computed(() => (showArchived.value ? allSubscriptions.value : subscriptions.value))
const subMonthly = computed(() =>
  subscriptions.value.reduce((s, a) => s + (a.bill_amount ? toMonthly(a.bill_amount, a.bill_frequency ?? 'monthly') : 0), 0),
)

/** The next time a subscription is billed, within the coming year. */
function nextBilled(a: Account): string | null {
  if (!a.next_bill_date) return null
  const from = new Date()
  const to = new Date(from.getFullYear() + 1, from.getMonth(), from.getDate())
  return payDates(a.next_bill_date, a.bill_frequency ?? 'monthly', from, to)[0] ?? null
}

async function removeSub(a: Account) {
  if (!confirm(`Delete "${a.name}"?`)) return
  const { data, error: err } = await supabase.from('accounts').delete().eq('id', a.id).select('id')
  if (err) return toast.error(friendlyError(err))
  if (!data?.length) return toast.error(friendlyError('permission denied'))
  toast.success('Deleted')
  await refreshNuxtData('ledger')
}
const totals = computed(() => snapshotAt(accounts.value, idx.value))
/** Change since this day last month, or null when nothing was logged back then. */
const monthChange = computed(() => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  const date = toISODate(d)
  if (!accounts.value.some((a) => entryAt(idx.value, a.id, date) !== undefined)) return null
  const prev = snapshotAt(accounts.value, idx.value, date)
  return { assets: totals.value.assets - prev.assets, debts: totals.value.debts - prev.debts, net: totals.value.net - prev.net }
})
const monthSub = (n: number | undefined) => (n === undefined ? undefined : `${signedMoney(n)} past month`)
const monthTone = (n: number | undefined, debt = false) => (n === undefined || n === 0 ? 'neutral' : (debt ? n < 0 : n > 0) ? 'good' : 'bad')
const trend = computed(() => netWorthSeries(accounts.value, idx.value, monthEndPoints(12)).filter((p) => p.hasData))

interface Row {
  account: Account
  balance: number
  change: number | null
  good: boolean
  updated: string | null
  stale: boolean
  spark: number[]
  meta: string
}

function rowFor(a: Account): Row {
  const list = idx.value.get(a.id) ?? []
  const last = list[list.length - 1]
  const prev = list[list.length - 2]
  const change = last && prev ? last.balance - prev.balance : null
  const debt = isDebt(a.type)
  const typeLabel = TYPE_META[a.type].label
  const parts = a.name.trim().toLowerCase() === typeLabel.toLowerCase() ? [] : [typeLabel]
  if (a.apr !== null) parts.push(`${a.apr}% APR`)
  if (a.type === 'home' || a.type === 'vehicle') {
    const loan = allAccounts.value.find((x) => x.id === a.linked_account_id)
    if (loan) parts.push(`linked to ${loan.name}`)
    const row = equityRows([a, ...(loan ? [loan] : [])], idx.value)[0]
    if (row) parts.push(`equity ${money(row.equity)}`)
  }
  if (a.institution) parts.push(a.institution)
  return {
    account: a,
    balance: last?.balance ?? 0,
    change,
    good: change === null ? true : debt ? change <= 0 : change >= 0,
    updated: last?.entry_date ?? null,
    stale: !last || daysSince(last.entry_date) > 35,
    spark: list.slice(-6).map((e) => e.balance),
    meta: parts.join(' · '),
  }
}

const groups = computed(() =>
  GROUP_ORDER.map((name) => {
    const rows = visible.value.filter((a) => TYPE_META[a.type].group === name).map(rowFor)
    return { name, rows, total: rows.filter((r) => !r.account.archived).reduce((s, r) => s + r.balance, 0), debt: name === 'Debts' }
  }).filter((g) => g.rows.length),
)
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Accounts</h1>
        <p class="text-base-content/70 text-sm">
          {{ accounts.length }} {{ accounts.length === 1 ? 'account' : 'accounts' }} · select one to see its history and log a new balance
        </p>
      </div>
      <button v-if="canAdd" class="btn btn-primary" @click="form?.open()">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add account
      </button>
    </header>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="Assets" :value="money(totals.assets)" :sub="monthSub(monthChange?.assets)" :sub-tone="monthTone(monthChange?.assets)" :spark="trend.map((p) => p.assets)" :spark-color="PALETTE.green" />
      <StatCard label="Debts" :value="money(totals.debts)" tone="debt" :sub="monthSub(monthChange?.debts)" :sub-tone="monthTone(monthChange?.debts, true)" :spark="trend.map((p) => p.debts)" :spark-color="PALETTE.orange" />
      <StatCard label="Net worth" :value="money(totals.net)" :sub="monthSub(monthChange?.net)" :sub-tone="monthTone(monthChange?.net)" :spark="trend.map((p) => p.net)" :spark-color="PALETTE.blue" />
    </div>

    <div v-if="pending && !allAccounts.length" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>Could not load your data: {{ error.message }}</span>
    </div>

    <div v-else-if="!visible.length && !visibleSubs.length" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 py-16 text-center">
        <h2 class="card-title">No accounts yet</h2>
        <p class="text-base-content/70 max-w-md">
          {{ canAdd
            ? 'Add checking, savings, investments, retirement, your home and car, plus any cards, loans and subscriptions.'
            : 'Nothing has been added yet. Accounts will show up here once someone with access adds them.' }}
        </p>
        <button v-if="canAdd" class="btn btn-primary mt-2" @click="form?.open()">Add your first account</button>
      </div>
    </div>

    <section v-if="visible.length" class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="All accounts">
      <div class="overflow-x-auto">
        <table class="table min-w-[44rem]">
          <thead>
            <tr class="text-base-content/70 text-xs">
              <th>Account</th>
              <th class="hidden sm:table-cell">Trend</th>
              <th class="text-right">Balance</th>
              <th class="text-right">Last change</th>
              <th class="text-right">Updated</th>
            </tr>
          </thead>
          <template v-for="g in groups" :key="g.name">
            <tbody>
              <tr class="bg-base-200">
                <th colspan="2" class="text-base-content/70 text-xs tracking-wider uppercase">{{ g.name }}</th>
                <th colspan="3" class="num text-base-content/70 text-right text-sm font-normal">{{ money(g.total) }}</th>
              </tr>
              <tr
                v-for="r in g.rows"
                :key="r.account.id"
                class="hover cursor-pointer"
                :class="{ 'opacity-60': r.account.archived }"
                @click="navigateTo(`/accounts/${r.account.id}`)"
              >
                <td>
                  <NuxtLink :to="`/accounts/${r.account.id}`" class="font-medium hover:underline" @click.stop>
                    {{ r.account.name }}
                  </NuxtLink>
                  <span v-if="r.account.archived" class="badge badge-ghost badge-sm ml-2">Archived</span>
                  <div class="text-base-content/70 text-sm">{{ r.meta }}</div>
                </td>
                <td class="hidden sm:table-cell">
                  <Sparkline :values="r.spark" :color="g.debt ? PALETTE.orange : PALETTE.green" />
                </td>
                <td class="num text-right font-medium" :class="{ 'text-error': g.debt }">{{ money(r.balance) }}</td>
                <td class="num text-right text-sm" :class="r.good ? 'text-success' : 'text-error'">
                  {{ r.change === null ? '—' : signedMoney(r.change) }}
                </td>
                <td class="text-right text-sm">
                  <div class="text-base-content/70">{{ r.updated ? shortDate(r.updated) : '—' }}</div>
                  <span v-if="r.stale && !r.account.archived" class="badge badge-warning badge-sm mt-1">Update due</span>
                </td>
              </tr>
            </tbody>
          </template>
        </table>
      </div>
    </section>

    <section v-if="visibleSubs.length" class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="Subscriptions">
      <div class="flex flex-col gap-3">
        <div class="bg-base-200 border-base-300 border-b px-4 py-3 sm:px-6">
          <h2 class="font-semibold">Subscriptions</h2>
          <p class="text-base-content/70 text-sm">
            {{ money(subMonthly) }} a month · {{ money(subMonthly * 12) }} a year. Not part of net worth.
          </p>
        </div>
        <ul class="divide-base-300 divide-y px-4 pb-2 sm:px-6">
          <li v-for="a in visibleSubs" :key="a.id" class="flex items-center justify-between gap-3 py-3" :class="{ 'opacity-60': a.archived }">
            <div class="min-w-0">
              <div class="truncate font-medium">
                {{ a.name }}
                <span v-if="a.archived" class="badge badge-ghost badge-sm ml-1">Archived</span>
              </div>
              <div class="text-base-content/70 text-sm">
                <template v-if="a.bill_amount !== null">
                  <span class="num">{{ money(a.bill_amount, true) }}</span> {{ FREQUENCY_LABEL[a.bill_frequency ?? 'monthly'].toLowerCase() }}
                  <template v-if="a.bill_frequency && a.bill_frequency !== 'monthly'"> · <span class="num">{{ money(toMonthly(a.bill_amount, a.bill_frequency)) }}</span>/mo</template>
                </template>
                <template v-else>No cost entered</template>
                <template v-if="nextBilled(a)"> · next {{ shortDate(nextBilled(a) as string) }}</template>
                <template v-else> · <NuxtLink to="/calendar" class="link">no billing date</NuxtLink></template>
                <template v-if="a.institution"> · {{ a.institution }}</template>
              </div>
            </div>
            <div v-if="canModify(a.created_by)" class="shrink-0">
              <button class="btn btn-ghost btn-xs" @click="form?.open(a)">Edit</button>
              <button class="btn btn-ghost btn-xs text-error" @click="removeSub(a)">Delete</button>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <label v-if="archivedCount" class="label cursor-pointer justify-start gap-3 text-sm">
      <input v-model="showArchived" type="checkbox" class="checkbox checkbox-sm" />
      Show {{ archivedCount }} archived {{ archivedCount === 1 ? 'item' : 'items' }}
    </label>

    <AccountForm ref="form" />
  </div>
</template>
