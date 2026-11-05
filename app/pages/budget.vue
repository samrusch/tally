<script setup lang="ts">
import type { BudgetItem, BudgetKind, IncomeSource } from '~/types'

useHead({ title: 'Budget · Tally' })

const supabase = useSupabaseClient()
const toast = useToast()
const { canAdd, canModify } = useHousehold()
const { income, items, debts, missingMinimums, summary, pending, error } = useBudgetSummary()

const form = ref<{ open: (t: any) => void }>()

const s = computed(() => summary.value)
const hasIncome = computed(() => income.value.some((i) => i.active))
const extras = computed(() => extraPaychecks(income.value))
const COLORS: Record<string, string> = {
  spending: PALETTE.blue,
  debt: PALETTE.orange,
  saving: PALETTE.green,
  extra_debt: PALETTE.purple,
  left: PALETTE.gray,
}
const segments = computed(() => s.value.allocation.filter((a) => a.monthly > 0))
const barSummary = computed(() =>
  segments.value.map((a) => `${a.label} ${money(a.monthly)} (${pct(a.share, 0)})`).join(', '),
)

const savings = computed(() => items.value.filter((i) => i.kind === 'saving'))
const extraDebt = computed(() => items.value.filter((i) => i.kind === 'extra_debt'))
const pausedExpenses = computed(() => items.value.filter((i) => i.kind === 'expense' && !i.active))

const perMonth = (amount: number, f: IncomeSource['frequency']) => toMonthly(amount, f)

async function remove(table: 'income_sources' | 'budget_items', id: string, label: string) {
  if (!confirm(`Delete "${label}"?`)) return
  const { data, error: err } = await supabase.from(table).delete().eq('id', id).select('id')
  if (err) return toast.error(friendlyError(err))
  if (!data?.length) return toast.error(friendlyError('permission denied'))
  toast.success('Deleted')
  await refreshNuxtData('budget')
}

const addItem = (kind: BudgetKind) => form.value?.open({ type: 'item', kind })
const editItem = (row: BudgetItem) => form.value?.open({ type: 'item', kind: row.kind, row })
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Budget</h1>
      <p class="text-base-content/70 text-sm">Your monthly plan: what comes in, where it goes, and what is left to assign.</p>
    </header>

    <div v-if="pending" class="flex justify-center py-24"><span class="loading loading-spinner loading-lg text-primary" /></div>
    <div v-else-if="error" role="alert" class="alert alert-error">
      <span>
        Could not load the budget: {{ error.message }}. If you just upgraded, run the latest <code>supabase/schema.sql</code> in the SQL Editor.
      </span>
    </div>

    <template v-else>
      <!-- Empty state -->
      <div v-if="!income.length && !items.length" class="card border-base-300 bg-base-100 border">
        <div class="card-body items-center gap-3 py-14 text-center">
          <h2 class="card-title">{{ canAdd ? 'Start with your income' : 'No budget yet' }}</h2>
          <p class="text-base-content/70 max-w-md">
            {{ canAdd
              ? 'Add your take-home pay, then your regular bills and spending, savings, and any extra you want to put toward debt. Tally shows what is left to assign.'
              : 'Nothing has been added yet. The budget fills in once someone with access adds income and spending.' }}
          </p>
          <button v-if="canAdd" class="btn btn-primary mt-2" @click="form?.open({ type: 'income' })">Add income</button>
        </div>
      </div>

      <template v-else>
        <!-- Summary -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Monthly income" :value="money(s.income)" sub="Take-home, averaged per month" />
          <StatCard
            label="Planned spending"
            :value="money(s.expenses + s.debtMinimums)"
            :sub="`${money(s.expenses)} spending + ${money(s.debtMinimums)} debt minimums`"
          />
          <StatCard
            label="Planned savings"
            :value="money(s.savings)"
            :sub="s.savingsRate === null ? 'Add income to see your rate' : `${pct(s.savingsRate)} of income`"
            :tone="s.savingsRate !== null && s.savingsRate >= 0.15 ? 'good' : 'neutral'"
          />
          <StatCard
            label="Left to assign"
            :value="money(s.left)"
            :tone="s.left < -0.5 ? 'bad' : 'good'"
            :sub="s.left < -0.5 ? 'The plan spends more than comes in' : Math.abs(s.left) <= 0.5 ? 'Every dollar has a job' : 'Free for extra debt, savings or goals'"
          />
        </div>

        <!-- Where the money goes -->
        <section v-if="s.income > 0" class="card border-base-300 bg-base-100 border" aria-label="Where your income goes">
          <div class="card-body gap-3">
            <div>
              <h2 class="font-semibold">Where your income goes</h2>
              <p class="text-base-content/70 text-sm">Each month's income, split by what you've planned</p>
            </div>
            <div class="bg-base-200 flex h-6 w-full overflow-hidden rounded-full" role="img" :aria-label="`Income split: ${barSummary}`">
              <div
                v-for="a in segments"
                :key="a.key"
                :style="{ width: `${Math.min(100, a.share * 100)}%`, backgroundColor: COLORS[a.key] }"
                :title="`${a.label}: ${money(a.monthly)}`"
              />
            </div>
            <ul class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <li v-for="a in s.allocation" :key="a.key" class="flex items-center gap-2">
                <span class="size-3 rounded-sm" :style="{ backgroundColor: COLORS[a.key] }" aria-hidden="true" />
                <span class="text-base-content/70">{{ a.label }}</span>
                <span class="num">{{ money(a.monthly) }}</span>
                <span class="text-base-content/60">{{ pct(a.share, 0) }}</span>
              </li>
            </ul>
            <p v-if="s.left < -0.5" class="text-error text-sm">
              Over by {{ money(Math.abs(s.left)) }} a month. Flexible spending is {{ money(s.flexible) }}, which is the first place to look.
            </p>
            <p v-else-if="s.buildRate !== null && s.extraDebt > 0" class="text-base-content/70 text-sm">
              Savings plus extra debt payments is {{ pct(s.buildRate) }} of income.
            </p>
          </div>
        </section>

        <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
          <!-- Income -->
          <section class="card border-base-300 bg-base-100 border lg:col-span-2" aria-label="Income">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="font-semibold">Income</h2>
                  <p class="text-base-content/70 text-sm">After taxes and deductions</p>
                </div>
                <button v-if="canAdd" class="btn btn-sm btn-primary" @click="form?.open({ type: 'income' })">Add income</button>
              </div>
              <p v-if="!income.length" class="text-base-content/70 py-4 text-sm">No income added yet.</p>
              <ul v-else class="divide-base-300 divide-y">
                <li v-for="i in income" :key="i.id" class="flex items-center justify-between gap-3 py-3" :class="{ 'opacity-50': !i.active }">
                  <div class="min-w-0">
                    <div class="truncate font-medium">
                      {{ i.name }}
                      <span v-if="!i.active" class="badge badge-ghost badge-sm ml-1">Paused</span>
                    </div>
                    <div class="text-base-content/70 text-sm">
                      <span class="num">{{ money(i.amount, true) }}</span> {{ FREQUENCY_LABEL[i.frequency].toLowerCase() }}
                      <template v-if="i.frequency !== 'monthly'"> · <span class="num">{{ money(perMonth(i.amount, i.frequency)) }}</span>/mo</template>
                    </div>
                  </div>
                  <div v-if="canModify(i.created_by)" class="shrink-0">
                    <button class="btn btn-ghost btn-xs" @click="form?.open({ type: 'income', row: i })">Edit</button>
                    <button class="btn btn-ghost btn-xs text-error" @click="remove('income_sources', i.id, i.name)">Delete</button>
                  </div>
                </li>
              </ul>
              <p v-for="x in extras" :key="x.name" class="text-base-content/70 bg-base-200 rounded-box p-3 text-sm">
                {{ x.name }}: {{ x.months }} months a year bring one extra paycheck. The plan uses the average, so
                those extra {{ money(x.amount) }} checks are a natural boost for debt or savings.
              </p>
            </div>
          </section>

          <!-- Spending -->
          <section class="card border-base-300 bg-base-100 border lg:col-span-3" aria-label="Spending">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="font-semibold">Spending</h2>
                  <p class="text-base-content/70 text-sm">
                    {{ money(s.fixed) }} fixed · {{ money(s.flexible) }} flexible per month
                  </p>
                </div>
                <button v-if="canAdd" class="btn btn-sm btn-primary" @click="addItem('expense')">Add spending</button>
              </div>

              <p v-if="!s.categories.length && !pausedExpenses.length" class="text-base-content/70 py-4 text-sm">
                No spending added yet. Start with your biggest bills, like housing, groceries and utilities.
              </p>

              <div v-for="c in s.categories" :key="c.category" class="border-base-300 rounded-box border">
                <div class="bg-base-200/60 flex items-center justify-between gap-3 rounded-t-[inherit] px-4 py-2">
                  <span class="font-medium">{{ c.category }}</span>
                  <span class="text-sm">
                    <span class="num">{{ money(c.monthly) }}</span>
                    <span class="text-base-content/60 ml-2">{{ s.income > 0 ? pct(c.share, 0) : '' }}</span>
                  </span>
                </div>
                <ul class="divide-base-300 divide-y">
                  <li v-for="r in c.items" :key="r.item.id" class="flex items-center justify-between gap-3 px-4 py-2">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium">
                        {{ r.item.name }}
                        <span v-if="r.item.flexible" class="badge badge-outline badge-sm ml-1">Flexible</span>
                      </div>
                      <div class="text-base-content/70 text-xs">
                        <span class="num">{{ money(r.item.amount, true) }}</span> {{ FREQUENCY_LABEL[r.item.frequency].toLowerCase() }}
                        <template v-if="r.item.frequency !== 'monthly'"> · <span class="num">{{ money(r.monthly) }}</span>/mo</template>
                        <template v-if="r.item.note"> · {{ r.item.note }}</template>
                      </div>
                    </div>
                    <div v-if="canModify(r.item.created_by)" class="shrink-0">
                      <button class="btn btn-ghost btn-xs" @click="editItem(r.item)">Edit</button>
                      <button class="btn btn-ghost btn-xs text-error" @click="remove('budget_items', r.item.id, r.item.name)">Delete</button>
                    </div>
                  </li>
                </ul>
              </div>

              <!-- Debt minimums come from the accounts -->
              <div v-if="debts.length" class="border-base-300 rounded-box border">
                <div class="bg-base-200/60 flex items-center justify-between gap-3 rounded-t-[inherit] px-4 py-2">
                  <span class="font-medium">Debt payments</span>
                  <span class="text-sm">
                    <span class="num">{{ money(s.debtMinimums) }}</span>
                    <span class="text-base-content/60 ml-2">{{ s.income > 0 ? pct(s.debtMinimums / s.income, 0) : '' }}</span>
                  </span>
                </div>
                <ul class="divide-base-300 divide-y">
                  <li v-for="d in debts" :key="d.id" class="flex items-center justify-between gap-3 px-4 py-2">
                    <NuxtLink :to="`/accounts/${d.id}`" class="link link-hover truncate text-sm font-medium">{{ d.name }}</NuxtLink>
                    <span v-if="d.minPayment" class="num text-sm">{{ money(d.minPayment, true) }}</span>
                    <span v-else class="badge badge-warning badge-sm">No minimum entered</span>
                  </li>
                </ul>
                <p class="text-base-content/70 px-4 py-2 text-xs">
                  Pulled from your debts, so they aren't entered twice (the mortgage included).
                  <template v-if="missingMinimums"> Add the missing {{ missingMinimums === 1 ? 'minimum' : 'minimums' }} on the account for an accurate total.</template>
                  Change a minimum on the account or in the <NuxtLink to="/debt" class="link">debt planner</NuxtLink>.
                </p>
              </div>

              <div v-if="pausedExpenses.length" class="text-base-content/60 text-sm">
                Paused:
                <template v-for="(p, n) in pausedExpenses" :key="p.id">
                  <button v-if="canModify(p.created_by)" class="link" @click="editItem(p)">{{ p.name }}</button>
                  <span v-else>{{ p.name }}</span>{{ n < pausedExpenses.length - 1 ? ', ' : '' }}
                </template>
              </div>
            </div>
          </section>
        </div>

        <!-- Savings and extra debt -->
        <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section class="card border-base-300 bg-base-100 border" aria-label="Savings">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="font-semibold">Savings</h2>
                  <p class="text-base-content/70 text-sm">
                    {{ money(s.savings) }} a month<template v-if="s.savingsRate !== null"> · {{ pct(s.savingsRate) }} of income</template>
                  </p>
                </div>
                <button v-if="canAdd" class="btn btn-sm btn-primary" @click="addItem('saving')">Add savings</button>
              </div>
              <p v-if="!savings.length" class="text-base-content/70 py-2 text-sm">
                Money you plan to set aside beyond what comes out of your paycheck, like emergency fund or investing.
              </p>
              <ul v-else class="divide-base-300 divide-y">
                <li v-for="r in savings" :key="r.id" class="flex items-center justify-between gap-3 py-2" :class="{ 'opacity-50': !r.active }">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">
                      {{ r.name }} <span class="badge badge-ghost badge-sm ml-1">{{ r.category }}</span>
                      <span v-if="!r.active" class="badge badge-ghost badge-sm ml-1">Paused</span>
                    </div>
                    <div class="text-base-content/70 text-xs">
                      <span class="num">{{ money(r.amount, true) }}</span> {{ FREQUENCY_LABEL[r.frequency].toLowerCase() }}
                      <template v-if="r.frequency !== 'monthly'"> · <span class="num">{{ money(perMonth(r.amount, r.frequency)) }}</span>/mo</template>
                    </div>
                  </div>
                  <div v-if="canModify(r.created_by)" class="shrink-0">
                    <button class="btn btn-ghost btn-xs" @click="editItem(r)">Edit</button>
                    <button class="btn btn-ghost btn-xs text-error" @click="remove('budget_items', r.id, r.name)">Delete</button>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <section class="card border-base-300 bg-base-100 border" aria-label="Extra debt payments">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="font-semibold">Extra debt payments</h2>
                  <p class="text-base-content/70 text-sm">
                    {{ money(s.extraDebt) }} a month beyond the minimums · {{ money(Math.max(0, s.availableForExtra)) }} available
                  </p>
                </div>
                <button v-if="canAdd" class="btn btn-sm btn-primary" @click="addItem('extra_debt')">Add payment</button>
              </div>
              <p v-if="!extraDebt.length" class="text-base-content/70 py-2 text-sm">
                Anything you plan to pay above the minimums. The <NuxtLink to="/debt" class="link">debt planner</NuxtLink> shows what it saves.
              </p>
              <ul v-else class="divide-base-300 divide-y">
                <li v-for="r in extraDebt" :key="r.id" class="flex items-center justify-between gap-3 py-2" :class="{ 'opacity-50': !r.active }">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">
                      {{ r.name }}
                      <span v-if="!r.active" class="badge badge-ghost badge-sm ml-1">Paused</span>
                    </div>
                    <div class="text-base-content/70 text-xs">
                      <span class="num">{{ money(r.amount, true) }}</span> {{ FREQUENCY_LABEL[r.frequency].toLowerCase() }}
                      <template v-if="r.frequency !== 'monthly'"> · <span class="num">{{ money(perMonth(r.amount, r.frequency)) }}</span>/mo</template>
                    </div>
                  </div>
                  <div v-if="canModify(r.created_by)" class="shrink-0">
                    <button class="btn btn-ghost btn-xs" @click="editItem(r)">Edit</button>
                    <button class="btn btn-ghost btn-xs text-error" @click="remove('budget_items', r.id, r.name)">Delete</button>
                  </div>
                </li>
              </ul>
            </div>
          </section>
        </div>

        <p v-if="!hasIncome" class="alert alert-warning text-sm">
          There is no active income yet, so percentages and the left-to-assign figure can't be calculated.
        </p>
      </template>

      <BudgetForm ref="form" />
    </template>
  </div>
</template>
