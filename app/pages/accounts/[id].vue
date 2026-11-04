<script setup lang="ts">
import type { Account, Entry, LineSeries } from '~/types'

const route = useRoute()
const supabase = useSupabaseClient()
const toast = useToast()
const { allAccounts, idx, pending, error } = useLedger()

const form = ref<{ open: (a?: Account) => void }>()

const account = computed(() => allAccounts.value.find((a) => a.id === route.params.id))
const meta = computed(() => (account.value ? TYPE_META[account.value.type] : null))
const debt = computed(() => !!meta.value?.debt)
const entries = computed<Entry[]>(() => idx.value.get(account.value?.id ?? '') ?? [])
const first = computed(() => entries.value[0])
const latest = computed(() => entries.value[entries.value.length - 1])
const previous = computed(() => entries.value[entries.value.length - 2])
const loan = computed(() =>
  account.value?.linked_account_id ? allAccounts.value.find((a) => a.id === account.value?.linked_account_id) : undefined,
)

useHead({ title: computed(() => `${account.value?.name ?? 'Account'} · Tally`) })

const isGood = (delta: number) => (debt.value ? delta <= 0 : delta >= 0)

/* ------------------------------ Summary ------------------------------ */

const change = computed(() => (latest.value && previous.value ? latest.value.balance - previous.value.balance : null))
const hasContributions = computed(() => entries.value.some((e) => e.contribution !== null && e.contribution !== 0))

const equity = computed(() => {
  if (!account.value || !meta.value?.property || !latest.value) return null
  const owed = loan.value ? (balanceAt(idx.value, loan.value.id) ?? 0) : 0
  const value = latest.value.balance
  return { value, owed, equity: value - owed, share: value > 0 ? (value - owed) / value : 0 }
})

const stats = computed(() => {
  const list: { label: string; value: string; tone: 'good' | 'bad' | 'neutral'; sub?: string }[] = []
  if (!latest.value || !first.value) return list
  if (entries.value.length > 1) {
    const delta = latest.value.balance - first.value.balance
    const rel = first.value.balance > 0 ? ` (${delta >= 0 ? '+' : '−'}${pct(Math.abs(delta) / first.value.balance)})` : ''
    list.push({
      label: `Change since ${shortDate(first.value.entry_date)}`,
      value: signedMoney(delta) + rel,
      tone: isGood(delta) ? 'good' : 'bad',
    })
    if (meta.value?.contributions && hasContributions.value) {
      const contrib = entries.value.slice(1).reduce((s, e) => s + (e.contribution ?? 0), 0)
      list.push({ label: 'From your deposits', value: money(contrib), tone: 'neutral' })
      list.push({ label: 'Growth and other change', value: signedMoney(delta - contrib), tone: delta - contrib >= 0 ? 'good' : 'bad' })
    }
  }
  list.push({ label: 'Updates logged', value: String(entries.value.length), tone: 'neutral' })
  return list
})

/* ------------------------------- Chart ------------------------------- */

const timeline = computed(() => {
  const dates = new Set(entries.value.map((e) => e.entry_date))
  if (loan.value && meta.value?.property) for (const e of idx.value.get(loan.value.id) ?? []) dates.add(e.entry_date)
  return [...dates].sort()
})

const chart = computed(() => {
  const a = account.value
  if (!a) return { labels: [] as string[], series: [] as LineSeries[] }
  const dates = timeline.value
  const main: LineSeries = {
    label: meta.value?.property ? 'Estimated value' : debt.value ? 'Amount owed' : 'Balance',
    data: dates.map((d) => balanceAt(idx.value, a.id, d)),
    color: debt.value ? PALETTE.orange : PALETTE.green,
  }
  const series: LineSeries[] = [main]

  if (meta.value?.property && loan.value) {
    main.fillToNext = true
    series.push({
      label: loan.value.name,
      data: dates.map((d) => balanceAt(idx.value, loan.value!.id, d)),
      color: PALETTE.orange,
      dashed: true,
    })
  } else if (meta.value?.contributions && hasContributions.value && first.value) {
    // Opening balance plus every deposit: what the balance would be with zero growth.
    let running = first.value.balance
    const byDate = new Map<string, number>()
    entries.value.forEach((e, i) => {
      if (i > 0) running += e.contribution ?? 0
      byDate.set(e.entry_date, running)
    })
    series.push({
      label: 'Opening balance + deposits',
      data: dates.map((d) => byDate.get(d) ?? null),
      color: PALETTE.gray,
      dashed: true,
    })
  }
  return { labels: dates.map(shortDate), series }
})

/* ------------------------------ History ------------------------------ */

const history = computed(() =>
  entries.value
    .map((e, i) => {
      const prev = entries.value[i - 1]
      const delta = prev ? e.balance - prev.balance : null
      const growth = delta !== null && e.contribution !== null ? delta - e.contribution : null
      return { entry: e, delta, growth }
    })
    .reverse(),
)
const showContribColumn = computed(() => !!meta.value?.contributions)
const showMileage = computed(() => account.value?.type === 'vehicle')

/* ------------------------------ Add update --------------------------- */

const date = ref(todayISO())
const balance = ref<string | number>('')
const contribution = ref<string | number>('')
const mileage = ref<string | number>('')
const source = ref('')
const note = ref('')
const saving = ref(false)
const formCard = ref<HTMLElement>()

const sources = computed(() =>
  account.value?.type === 'home'
    ? ['Online estimate', 'Appraisal', 'Nearby sale', 'My own estimate']
    : ['Online estimate', 'Dealer offer', 'Similar listings', 'My own estimate'],
)

// v-model on <input type="number"> yields a number (or '' when empty), not a string.
const numOrNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function save() {
  if (!account.value || saving.value) return
  saving.value = true
  const { error: err } = await supabase.from('balance_entries').upsert(
    {
      account_id: account.value.id,
      entry_date: date.value,
      balance: Number(balance.value),
      contribution: meta.value?.contributions ? numOrNull(contribution.value) : null,
      mileage: showMileage.value ? numOrNull(mileage.value) : null,
      source: meta.value?.property ? source.value || null : null,
      note: note.value.trim() || null,
    },
    { onConflict: 'account_id,entry_date' },
  )
  saving.value = false
  if (err) {
    toast.error(err.message)
    return
  }
  toast.success('Update saved')
  balance.value = ''
  contribution.value = ''
  mileage.value = ''
  note.value = ''
  date.value = todayISO()
  await refreshNuxtData('ledger')
}

function editEntry(e: Entry) {
  date.value = e.entry_date
  balance.value = String(e.balance)
  contribution.value = e.contribution === null ? '' : String(e.contribution)
  mileage.value = e.mileage === null ? '' : String(e.mileage)
  source.value = e.source ?? ''
  note.value = e.note ?? ''
  formCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function removeEntry(e: Entry) {
  if (!confirm(`Delete the ${fmtDate(e.entry_date)} entry (${money(e.balance, true)})?`)) return
  const { error: err } = await supabase.from('balance_entries').delete().eq('id', e.id)
  if (err) return toast.error(err.message)
  toast.success('Entry deleted')
  await refreshNuxtData('ledger')
}

async function removeAccount() {
  if (!account.value) return
  if (!confirm(`Delete "${account.value.name}" and all ${entries.value.length} of its entries? This cannot be undone.`)) return
  const { error: err } = await supabase.from('accounts').delete().eq('id', account.value.id)
  if (err) return toast.error(err.message)
  toast.success('Account deleted')
  await refreshNuxtData('ledger')
  await navigateTo('/accounts')
}
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <div v-if="pending && !account" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>Could not load your data: {{ error.message }}</span>
    </div>

    <div v-else-if="!account" class="card border-base-300 bg-base-100 border">
      <div class="card-body items-center gap-3 py-16 text-center">
        <h2 class="card-title">Account not found</h2>
        <NuxtLink to="/accounts" class="btn btn-primary">Back to accounts</NuxtLink>
      </div>
    </div>

    <template v-else-if="meta">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="text-base-content/70 text-sm">
            <NuxtLink to="/accounts" class="underline">Accounts</NuxtLink> / {{ meta.group }}
          </div>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight">
            {{ account.name }}
            <span v-if="account.archived" class="badge badge-ghost align-middle">Archived</span>
          </h1>
          <p class="text-base-content/70 mt-1 text-sm">
            {{ [meta.label, account.apr !== null ? `${account.apr}% APR` : null, account.institution, account.identifier]
              .filter(Boolean)
              .join(' · ') }}
            <template v-if="latest"> · last updated {{ fmtDate(latest.entry_date) }}</template>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <div class="text-right">
            <div class="num text-3xl font-medium tracking-tight" :class="{ 'text-error': debt }">
              {{ money(latest?.balance ?? 0) }}
            </div>
            <div v-if="change !== null" class="text-sm" :class="isGood(change) ? 'text-success' : 'text-error'">
              {{ signedMoney(change) }} since {{ shortDate(previous!.entry_date) }}
            </div>
          </div>
          <div class="dropdown dropdown-end">
            <div tabindex="0" role="button" class="btn btn-square btn-ghost" aria-label="Account actions">
              <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
              </svg>
            </div>
            <ul tabindex="0" class="dropdown-content menu bg-base-100 border-base-300 z-10 w-52 rounded-box border p-2 shadow">
              <li><button @click="form?.open(account)">Edit account</button></li>
              <li><button class="text-error" @click="removeAccount">Delete account</button></li>
            </ul>
          </div>
        </div>
      </header>

      <!-- Equity summary for homes and vehicles -->
      <div v-if="equity" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Estimated value" :value="money(equity.value)" />
        <StatCard
          :label="loan ? `${loan.name} balance` : 'Loan balance'"
          :value="money(equity.owed)"
          :tone="equity.owed > 0 ? 'debt' : 'neutral'"
          :sub="loan ? undefined : 'No loan linked'"
        />
        <StatCard label="Equity" :value="money(equity.equity)" tone="good" />
        <StatCard label="Equity share of value" :value="pct(equity.share)" />
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard v-for="s in stats" :key="s.label" :label="s.label" :value="s.value" :tone="s.tone" :sub="s.sub" />
      </div>

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <section class="card border-base-300 bg-base-100 border lg:col-span-3" aria-label="Balance history">
          <div class="card-body gap-3">
            <div>
              <h2 class="font-semibold">
                {{ meta.property && loan ? `Value vs. ${loan.name.toLowerCase()}` : 'Balance history' }}
              </h2>
              <p class="text-base-content/70 text-sm">
                <template v-if="meta.property && loan">Equity is the shaded gap between the two lines</template>
                <template v-else-if="meta.contributions && hasContributions">The gap above the dashed line is growth you didn't deposit</template>
                <template v-else>Every balance you've logged</template>
              </p>
            </div>
            <LineChart
              v-if="entries.length > 1"
              :labels="chart.labels"
              :series="chart.series"
              :description="`${account.name} balance over time`"
            />
            <p v-else class="text-base-content/70 py-12 text-center text-sm">
              Log a second balance and the chart will appear.
            </p>
          </div>
        </section>

        <section ref="formCard" class="card border-base-300 bg-base-100 border lg:col-span-2" aria-label="Record an update">
          <form class="card-body gap-3" @submit.prevent="save">
            <div>
              <h2 class="font-semibold">Record an update</h2>
              <p v-if="latest" class="text-base-content/70 text-sm">
                Last entry: {{ money(latest.balance, true) }} on {{ shortDate(latest.entry_date) }}. Saving a date that
                already exists replaces it.
              </p>
            </div>

            <fieldset class="fieldset">
              <label class="label" for="u-date">As of</label>
              <input id="u-date" v-model="date" type="date" class="input w-full" required />
            </fieldset>

            <div class="grid gap-3" :class="showMileage ? 'grid-cols-2' : 'grid-cols-1'">
              <fieldset class="fieldset">
                <label class="label" for="u-bal">{{ debt ? 'New amount owed' : meta.property ? 'New estimated value' : 'New balance' }}</label>
                <input id="u-bal" v-model="balance" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" required placeholder="0.00" />
              </fieldset>
              <fieldset v-if="showMileage" class="fieldset">
                <label class="label" for="u-mi">Mileage</label>
                <input id="u-mi" v-model="mileage" type="number" step="1" min="0" inputmode="numeric" class="input num w-full" placeholder="0" />
              </fieldset>
            </div>

            <fieldset v-if="meta.contributions" class="fieldset">
              <label class="label" for="u-con">Deposits since last update <span class="opacity-60">(optional)</span></label>
              <input id="u-con" v-model="contribution" type="number" step="0.01" inputmode="decimal" class="input num w-full" placeholder="0.00" />
              <p class="label whitespace-normal">Lets Tally split your change into deposits and growth.</p>
            </fieldset>

            <fieldset v-if="meta.property" class="fieldset">
              <label class="label" for="u-src">Where it came from</label>
              <select id="u-src" v-model="source" class="select w-full">
                <option value="">Not specified</option>
                <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <label class="label" for="u-note">Note <span class="opacity-60">(optional)</span></label>
              <input id="u-note" v-model="note" type="text" class="input w-full" placeholder="e.g. Bonus deposited" />
            </fieldset>

            <button type="submit" class="btn btn-primary mt-1" :disabled="saving">
              <span v-if="saving" class="loading loading-spinner loading-sm" />
              Save update
            </button>
          </form>
        </section>
      </div>

      <section class="card border-base-300 bg-base-100 overflow-hidden border" aria-label="History">
        <div class="card-body pb-2">
          <h2 class="font-semibold">History</h2>
          <p class="text-base-content/70 text-sm">Every balance you've logged, newest first</p>
        </div>
        <div class="overflow-x-auto">
          <table class="table min-w-[40rem]">
            <thead>
              <tr class="text-base-content/70 text-xs">
                <th>Date</th>
                <th class="text-right">{{ debt ? 'Owed' : meta.property ? 'Value' : 'Balance' }}</th>
                <th class="text-right">Change</th>
                <th v-if="showContribColumn" class="text-right">Deposits</th>
                <th v-if="showContribColumn" class="text-right">Growth</th>
                <th v-if="showMileage" class="text-right">Mileage</th>
                <th>Note</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in history" :key="h.entry.id" class="hover">
                <td>{{ fmtDate(h.entry.entry_date) }}</td>
                <td class="num text-right font-medium">{{ money(h.entry.balance) }}</td>
                <td class="num text-right" :class="h.delta === null ? '' : isGood(h.delta) ? 'text-success' : 'text-error'">
                  {{ h.delta === null ? '—' : signedMoney(h.delta) }}
                </td>
                <td v-if="showContribColumn" class="num text-right">{{ h.entry.contribution === null ? '—' : money(h.entry.contribution) }}</td>
                <td
                  v-if="showContribColumn"
                  class="num text-right"
                  :class="h.growth === null ? '' : h.growth >= 0 ? 'text-success' : 'text-error'"
                >
                  {{ h.growth === null ? '—' : signedMoney(h.growth) }}
                </td>
                <td v-if="showMileage" class="num text-right">{{ h.entry.mileage === null ? '—' : h.entry.mileage.toLocaleString('en-US') }}</td>
                <td class="text-base-content/70 max-w-48 truncate text-sm">
                  {{ [h.entry.source, h.entry.note].filter(Boolean).join(' · ') }}
                </td>
                <td class="text-right whitespace-nowrap">
                  <button class="btn btn-ghost btn-xs" @click="editEntry(h.entry)">Edit</button>
                  <button class="btn btn-ghost btn-xs text-error" @click="removeEntry(h.entry)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <AccountForm ref="form" />
    </template>
  </div>
</template>
