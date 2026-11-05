<script setup lang="ts">
import type { Goal, GoalKind } from '~/types'

type Target = { kind: GoalKind; row?: Goal }

const supabase = useSupabaseClient()
const toast = useToast()
const { household } = useHousehold()
const { allAccounts } = useLedger()

const dialog = ref<HTMLDialogElement>()
const kind = ref<GoalKind>('target')
const editingId = ref<string | null>(null)
const saving = ref(false)

const name = ref('')
const targetAmount = ref<string | number>('')
const targetHigh = ref<string | number>('')
const targetDate = ref('')
const currentAge = ref<string | number>('')
const targetAge = ref<string | number>('')
const annualSpending = ref<string | number>('')
const withdrawal = ref<string | number>(4)
const saved = ref<string | number>(0)
const monthly = ref<string | number>(0)
const rate = ref<string | number>(4)
const linked = ref<string[]>([])
const note = ref('')
const active = ref(true)

const isRetirement = computed(() => kind.value === 'retirement')
const assetAccounts = computed(() => allAccounts.value.filter((a) => !a.archived && !isDebt(a.type)))
const title = computed(() => `${editingId.value ? 'Edit' : 'Add'} ${isRetirement.value ? 'retirement goal' : 'savings goal'}`)

const numOrNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function open(t: Target) {
  kind.value = t.kind
  const g = t.row
  editingId.value = g?.id ?? null
  name.value = g?.name ?? (t.kind === 'retirement' ? 'Retirement' : '')
  targetAmount.value = g?.target_amount ?? ''
  targetHigh.value = g?.target_amount_high ?? ''
  targetDate.value = g?.target_date ?? ''
  currentAge.value = g && g.current_age !== null ? Math.floor(ageNow(g.current_age, g.age_set_on, new Date())) : ''
  targetAge.value = g?.target_age ?? ''
  annualSpending.value = g?.annual_spending ?? ''
  withdrawal.value = g?.withdrawal_rate ?? 4
  saved.value = g?.saved ?? 0
  monthly.value = g?.monthly_contribution ?? 0
  rate.value = g?.expected_return ?? (t.kind === 'retirement' ? 5 : 4)
  linked.value = g
    ? [...g.linked_account_ids]
    : t.kind === 'retirement'
      ? assetAccounts.value.filter((a) => a.type === 'retirement').map((a) => a.id)
      : []
  note.value = g?.note ?? ''
  active.value = g?.active ?? true
  dialog.value?.showModal()
}
defineExpose({ open })

async function submit() {
  if (saving.value) return
  if (!household.value) return toast.error('No household found. Reload the page and try again.')
  const common = {
    name: name.value.trim(),
    saved: numOrNull(saved.value) ?? 0,
    monthly_contribution: numOrNull(monthly.value) ?? 0,
    expected_return: numOrNull(rate.value) ?? 0,
    linked_account_ids: linked.value,
    note: note.value.trim() || null,
    active: active.value,
  }
  let fields
  if (isRetirement.value) {
    const cur = numOrNull(currentAge.value)
    const tgt = numOrNull(targetAge.value)
    const spend = numOrNull(annualSpending.value)
    if (cur === null || tgt === null || spend === null) return toast.error('Fill in your age, the age you want to retire and yearly spending')
    if (tgt <= cur) return toast.error('The retirement age has to be later than your current age')
    fields = {
      ...common,
      current_age: cur,
      age_set_on: todayISO(),
      target_age: tgt,
      annual_spending: spend,
      withdrawal_rate: numOrNull(withdrawal.value) ?? 4,
      target_amount: null,
      target_amount_high: null,
      target_date: null,
    }
  } else {
    const amount = numOrNull(targetAmount.value)
    const high = numOrNull(targetHigh.value)
    if (amount === null || !targetDate.value) return toast.error('Fill in the amount and the date')
    if (high !== null && high < amount) return toast.error('The top of the range has to be at least the amount')
    fields = { ...common, target_amount: amount, target_amount_high: high, target_date: targetDate.value }
  }

  saving.value = true
  try {
    if (editingId.value) {
      const { data, error } = await supabase.from('goals').update(fields).eq('id', editingId.value).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('permission denied')
      toast.success('Goal saved')
    } else {
      const { error } = await supabase.from('goals').insert({ ...fields, kind: kind.value, household_id: household.value.id })
      if (error) throw error
      toast.success('Goal added')
    }
    dialog.value?.close()
    await refreshNuxtData('goals')
  } catch (e) {
    toast.error(friendlyError(e, 'Could not save the goal'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle">
    <div class="modal-box max-h-[90vh]">
      <form method="dialog">
        <button class="btn btn-sm btn-circle btn-ghost absolute top-3 right-3" aria-label="Close">✕</button>
      </form>
      <h2 class="text-xl font-semibold">{{ title }}</h2>

      <form class="mt-5 flex flex-col gap-4" @submit.prevent="submit">
        <fieldset class="fieldset">
          <label class="label" for="g-name">Name</label>
          <input id="g-name" v-model="name" type="text" class="input w-full" required maxlength="120" :placeholder="isRetirement ? 'Retire at 55' : 'e.g. House remodel'" />
        </fieldset>

        <template v-if="!isRetirement">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset class="fieldset">
              <label class="label" for="g-amount">Amount needed</label>
              <input id="g-amount" v-model="targetAmount" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" required placeholder="100000" />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="g-high">Top of the range <span class="opacity-60">(optional)</span></label>
              <input id="g-high" v-model="targetHigh" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" placeholder="e.g. 600000" />
            </fieldset>
          </div>
          <p class="text-base-content/70 -mt-2 text-xs">
            If you give a range, the plan aims for the top of it. If you'll finance part of it, enter the cash you need, like the down payment, not the full price.
          </p>
          <fieldset class="fieldset">
            <label class="label" for="g-date">Needed by</label>
            <input id="g-date" v-model="targetDate" type="date" class="input w-full" required />
          </fieldset>
        </template>

        <template v-else>
          <div class="grid grid-cols-2 gap-4">
            <fieldset class="fieldset">
              <label class="label" for="g-age">Your age now</label>
              <input id="g-age" v-model="currentAge" type="number" step="1" min="0" max="120" inputmode="numeric" class="input num w-full" required />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="g-tage">Retire at age</label>
              <input id="g-tage" v-model="targetAge" type="number" step="1" min="1" max="120" inputmode="numeric" class="input num w-full" required placeholder="55" />
            </fieldset>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset class="fieldset">
              <label class="label" for="g-spend">Yearly spending in retirement</label>
              <input id="g-spend" v-model="annualSpending" type="number" step="100" min="0" inputmode="decimal" class="input num w-full" required placeholder="90000" />
            </fieldset>
            <fieldset class="fieldset">
              <label class="label" for="g-wd">Withdrawal rate %</label>
              <input id="g-wd" v-model="withdrawal" type="number" step="0.1" min="0.1" max="20" inputmode="decimal" class="input num w-full" required />
            </fieldset>
          </div>
          <p class="text-base-content/70 -mt-2 text-xs">
            Use today's dollars. The nest egg you need is yearly spending divided by the withdrawal rate: at 4%, $90,000 a year needs about $2.25 million.
            A lower rate is more cautious, especially for a long retirement.
          </p>
        </template>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <fieldset class="fieldset">
            <label class="label" for="g-saved">Already set aside</label>
            <input id="g-saved" v-model="saved" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label" for="g-monthly">Planned per month</label>
            <input id="g-monthly" v-model="monthly" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" />
          </fieldset>
        </div>
        <p class="text-base-content/70 -mt-2 text-xs">"Already set aside" is money outside your tracked accounts. Accounts you link below count automatically.</p>

        <fieldset class="fieldset">
          <label class="label" for="g-rate">
            Expected yearly return %
            <span v-if="isRetirement" class="opacity-60">(after inflation)</span>
          </label>
          <input id="g-rate" v-model="rate" type="number" step="0.1" min="-20" max="30" inputmode="decimal" class="input num w-full" />
          <p class="label whitespace-normal">Your assumption, not a promise. Use 0 for cash you're just setting aside.</p>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="label">Count these accounts toward the goal</legend>
          <p v-if="!assetAccounts.length" class="text-base-content/70 text-sm">No accounts yet.</p>
          <div class="flex max-h-40 flex-col gap-1 overflow-y-auto">
            <label v-for="a in assetAccounts" :key="a.id" class="flex cursor-pointer items-center gap-3 py-1 text-sm">
              <input v-model="linked" :value="a.id" type="checkbox" class="checkbox checkbox-sm" />
              <span>{{ a.name }}</span>
              <span class="text-base-content/60 text-xs">{{ TYPE_META[a.type].label }}</span>
            </label>
          </div>
          <p class="label whitespace-normal">The same account can count toward more than one goal, so check you aren't counting it twice.</p>
        </fieldset>

        <fieldset class="fieldset">
          <label class="label" for="g-note">Note <span class="opacity-60">(optional)</span></label>
          <input id="g-note" v-model="note" type="text" class="input w-full" maxlength="200" />
        </fieldset>

        <label v-if="editingId" class="label cursor-pointer justify-start gap-3">
          <input v-model="active" type="checkbox" class="checkbox checkbox-sm" />
          <span>Include in the plan (untick to pause it)</span>
        </label>

        <div class="modal-action mt-2">
          <button type="button" class="btn" @click="dialog?.close()">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            Save goal
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
</template>
