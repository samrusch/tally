<script setup lang="ts">
import type { Account } from '~/types'

useHead({ title: 'Accounts · Tally' })

const { accounts, allAccounts, idx, pending, error } = useLedger()
const { canAdd } = useHousehold()
const form = ref<{ open: (a?: Account) => void }>()
const showArchived = ref(false)

const visible = computed(() => (showArchived.value ? allAccounts.value : accounts.value))
const archivedCount = computed(() => allAccounts.value.filter((a) => a.archived).length)
const totals = computed(() => snapshotAt(accounts.value, idx.value))

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
      <StatCard label="Assets" :value="money(totals.assets)" />
      <StatCard label="Debts" :value="money(totals.debts)" tone="debt" />
      <StatCard label="Net worth" :value="money(totals.net)" />
    </div>

    <div v-if="pending && !allAccounts.length" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>Could not load your data: {{ error.message }}</span>
    </div>

    <div v-else-if="!visible.length" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 py-16 text-center">
        <h2 class="card-title">No accounts yet</h2>
        <p class="text-base-content/70 max-w-md">
          {{ canAdd
            ? 'Add checking, savings, investments, retirement, your home and car, plus any cards and loans.'
            : 'Nothing has been added yet. Accounts will show up here once someone with access adds them.' }}
        </p>
        <button v-if="canAdd" class="btn btn-primary mt-2" @click="form?.open()">Add your first account</button>
      </div>
    </div>

    <section v-else class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="All accounts">
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

    <label v-if="archivedCount" class="label cursor-pointer justify-start gap-3 text-sm">
      <input v-model="showArchived" type="checkbox" class="checkbox checkbox-sm" />
      Show {{ archivedCount }} archived {{ archivedCount === 1 ? 'account' : 'accounts' }}
    </label>

    <AccountForm ref="form" />
  </div>
</template>
