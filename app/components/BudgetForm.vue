<script setup lang="ts">
import type { BudgetItem, BudgetKind, Frequency, IncomeSource } from '~/types'

type Target =
  | { type: 'income'; row?: IncomeSource }
  | { type: 'item'; kind: BudgetKind; row?: BudgetItem }

const supabase = useSupabaseClient()
const toast = useToast()
const { household } = useHousehold()

const dialog = ref<HTMLDialogElement>()
const target = ref<Target>({ type: 'income' })
const editingId = ref<string | null>(null)
const saving = ref(false)

const name = ref('')
const amount = ref<string | number>('')
const frequency = ref<Frequency>('monthly')
const category = ref('Other')
const flexible = ref(false)
const active = ref(true)
const note = ref('')

const isIncome = computed(() => target.value.type === 'income')
const kind = computed<BudgetKind>(() => (target.value.type === 'item' ? target.value.kind : 'expense'))
const categories = computed(() => KIND_META[kind.value].categories)

const title = computed(() => {
  const verb = editingId.value ? 'Edit' : 'Add'
  if (isIncome.value) return `${verb} income`
  return `${verb} ${{ expense: 'spending', saving: 'savings', extra_debt: 'extra debt payment' }[kind.value]}`
})
const amountLabel = computed(() => (isIncome.value ? 'Take-home pay per paycheck' : 'Amount'))
const namePlaceholder = computed(() =>
  isIncome.value
    ? 'e.g. Paycheck'
    : ({ expense: 'e.g. Groceries', saving: 'e.g. Emergency fund', extra_debt: 'e.g. Extra on the credit card' }[kind.value]),
)

function open(t: Target) {
  target.value = t
  const row = t.row
  editingId.value = row?.id ?? null
  name.value = row?.name ?? ''
  amount.value = row ? String(row.amount) : ''
  frequency.value = row?.frequency ?? (t.type === 'income' ? 'biweekly' : 'monthly')
  active.value = row?.active ?? true
  note.value = row?.note ?? ''
  if (t.type === 'item') {
    const list = KIND_META[t.kind].categories
    const existing = t.row?.category
    category.value = existing && list.includes(existing) ? existing : (existing ?? list[0] ?? 'Other')
    flexible.value = t.row?.flexible ?? false
  }
  dialog.value?.showModal()
}
defineExpose({ open })

async function submit() {
  if (saving.value) return
  const value = Number(amount.value)
  if (!Number.isFinite(value) || value < 0) return toast.error('Enter an amount of zero or more')
  if (!household.value) return toast.error('No household found. Reload the page and try again.')
  saving.value = true
  try {
    const base = {
      name: name.value.trim(),
      amount: value,
      frequency: frequency.value,
      active: active.value,
      note: note.value.trim() || null,
    }
    const table = isIncome.value ? 'income_sources' : 'budget_items'
    const fields = isIncome.value ? base : { ...base, category: category.value, flexible: kind.value === 'expense' && flexible.value }

    if (editingId.value) {
      const { data, error } = await supabase.from(table).update(fields).eq('id', editingId.value).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('permission denied')
      toast.success('Saved')
    } else {
      const insert = isIncome.value
        ? supabase.from('income_sources').insert({ ...base, household_id: household.value.id })
        : supabase.from('budget_items').insert({ ...base, category: category.value, flexible: kind.value === 'expense' && flexible.value, kind: kind.value, household_id: household.value.id })
      const { error } = await insert
      if (error) throw error
      toast.success('Added')
    }
    dialog.value?.close()
    await refreshNuxtData('budget')
  } catch (e) {
    toast.error(friendlyError(e, 'Could not save'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle">
    <div class="modal-box">
      <form method="dialog">
        <button class="btn btn-sm btn-circle btn-ghost absolute top-3 right-3" aria-label="Close">✕</button>
      </form>
      <h2 class="text-xl font-semibold">{{ title }}</h2>
      <p v-if="isIncome" class="text-base-content/70 mt-1 text-sm">Use pay after taxes and deductions, the amount that lands in your account.</p>

      <form class="mt-5 flex flex-col gap-4" @submit.prevent="submit">
        <fieldset class="fieldset">
          <label class="label" for="b-name">Name</label>
          <input id="b-name" v-model="name" type="text" class="input w-full" required maxlength="120" :placeholder="namePlaceholder" />
        </fieldset>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <fieldset class="fieldset">
            <label class="label" for="b-amount">{{ amountLabel }}</label>
            <input id="b-amount" v-model="amount" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" required placeholder="0.00" />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label" for="b-freq">How often</label>
            <select id="b-freq" v-model="frequency" class="select w-full">
              <option v-for="f in FREQUENCIES" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </fieldset>
        </div>

        <fieldset v-if="!isIncome" class="fieldset">
          <label class="label" for="b-cat">Category</label>
          <select id="b-cat" v-model="category" class="select w-full">
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
            <option v-if="!categories.includes(category)" :value="category">{{ category }}</option>
          </select>
        </fieldset>

        <label v-if="kind === 'expense' && !isIncome" class="label cursor-pointer justify-start gap-3">
          <input v-model="flexible" type="checkbox" class="checkbox checkbox-sm" />
          <span>Flexible: I could trim this if money is tight</span>
        </label>

        <fieldset class="fieldset">
          <label class="label" for="b-note">Note <span class="opacity-60">(optional)</span></label>
          <input id="b-note" v-model="note" type="text" class="input w-full" maxlength="200" />
        </fieldset>

        <label v-if="editingId" class="label cursor-pointer justify-start gap-3">
          <input v-model="active" type="checkbox" class="checkbox checkbox-sm" />
          <span>Include in the plan (untick to pause it without deleting)</span>
        </label>

        <div class="modal-action mt-2">
          <button type="button" class="btn" @click="dialog?.close()">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            Save
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
</template>
