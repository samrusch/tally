<script setup lang="ts">
import type { Account, AccountType } from '~/types'

const supabase = useSupabaseClient()
const toast = useToast()
const { allAccounts } = useLedger()

const dialog = ref<HTMLDialogElement>()
const mode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const saving = ref(false)

const type = ref<AccountType>('checking')
const name = ref('')
const institution = ref('')
const identifier = ref('')
const apr = ref<string | number>('')
const minPayment = ref<string | number>('')
const linkedId = ref('')
const archived = ref(false)
const balance = ref<string | number>('')
const asOf = ref(todayISO())

const meta = computed(() => TYPE_META[type.value])
const debtOptions = computed(() =>
  allAccounts.value.filter((a) => isDebt(a.type) && a.id !== editingId.value && !a.archived),
)

const balanceLabel = computed(() =>
  meta.value.debt ? 'Amount owed' : meta.value.property ? 'Estimated value' : 'Current balance',
)
const identifierLabel = computed(() => (type.value === 'home' ? 'Address' : 'VIN'))
const namePlaceholder = computed(
  () =>
    ({
      home: 'e.g. Main house',
      vehicle: 'e.g. Family SUV',
      credit_card: 'e.g. Rewards card',
      mortgage: 'e.g. Home mortgage',
      loan: 'e.g. Auto loan',
    })[type.value as string] ?? 'e.g. Everyday checking',
)
const countsAs = computed(() =>
  meta.value.debt
    ? 'Counts as a debt: it subtracts from net worth and feeds the debt payoff projection.'
    : meta.value.property
      ? 'Counts as an asset. Link a loan below and Tally tracks your equity (value minus loan balance).'
      : 'Counts as an asset: it adds to net worth.',
)

function reset() {
  type.value = 'checking'
  name.value = ''
  institution.value = ''
  identifier.value = ''
  apr.value = ''
  minPayment.value = ''
  linkedId.value = ''
  archived.value = false
  balance.value = ''
  asOf.value = todayISO()
}

function open(account?: Account) {
  reset()
  if (account) {
    mode.value = 'edit'
    editingId.value = account.id
    type.value = account.type
    name.value = account.name
    institution.value = account.institution ?? ''
    identifier.value = account.identifier ?? ''
    apr.value = account.apr === null ? '' : String(account.apr)
    minPayment.value = account.min_payment === null ? '' : String(account.min_payment)
    linkedId.value = account.linked_account_id ?? ''
    archived.value = account.archived
  } else {
    mode.value = 'create'
    editingId.value = null
  }
  dialog.value?.showModal()
}

defineExpose({ open })

// v-model on <input type="number"> yields a number (or '' when empty), not a string.
const numOrNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function submit() {
  if (saving.value) return
  saving.value = true
  try {
    const fields = {
      name: name.value.trim(),
      institution: meta.value.property ? null : institution.value.trim() || null,
      identifier: meta.value.property ? identifier.value.trim() || null : null,
      apr: meta.value.debt ? numOrNull(apr.value) : null,
      min_payment: meta.value.debt ? numOrNull(minPayment.value) : null,
      linked_account_id: meta.value.property ? linkedId.value || null : null,
    }

    if (mode.value === 'edit' && editingId.value) {
      const { error } = await supabase
        .from('accounts')
        .update({ ...fields, archived: archived.value })
        .eq('id', editingId.value)
      if (error) throw error
      toast.success('Account saved')
    } else {
      const { data, error } = await supabase
        .from('accounts')
        .insert({ ...fields, type: type.value })
        .select('id')
        .single()
      if (error) throw error

      const first = await supabase.from('balance_entries').insert({
        account_id: data.id,
        entry_date: asOf.value,
        balance: Number(balance.value),
        note: 'Opening balance',
      })
      if (first.error) {
        // Don't leave an account behind with no history.
        await supabase.from('accounts').delete().eq('id', data.id)
        throw first.error
      }
      toast.success('Account added')
    }

    dialog.value?.close()
    await refreshNuxtData('ledger')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not save the account')
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

      <h2 class="text-xl font-semibold">{{ mode === 'create' ? 'Add account' : 'Edit account' }}</h2>
      <p class="text-base-content/70 mt-1 text-sm">
        {{ mode === 'create' ? "Pick a type, name it, and enter today's balance." : 'Change details here. Balances are updated from the account page.' }}
      </p>

      <form class="mt-5 flex flex-col gap-4" @submit.prevent="submit">
        <fieldset class="fieldset">
          <label class="label" for="acc-type">Account type</label>
          <select id="acc-type" v-model="type" class="select w-full" :disabled="mode === 'edit'">
            <optgroup label="Assets (what you own)">
              <option v-for="o in TYPE_OPTIONS.filter((x) => x.group.startsWith('Assets'))" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </optgroup>
            <optgroup label="Debts (what you owe)">
              <option v-for="o in TYPE_OPTIONS.filter((x) => x.group.startsWith('Debts'))" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </optgroup>
          </select>
          <p class="label whitespace-normal" :class="meta.debt ? 'text-error' : 'text-success'">{{ countsAs }}</p>
        </fieldset>

        <fieldset class="fieldset">
          <label class="label" for="acc-name">Account name</label>
          <input id="acc-name" v-model="name" type="text" class="input w-full" required maxlength="120" :placeholder="namePlaceholder" />
        </fieldset>

        <fieldset v-if="meta.property" class="fieldset">
          <label class="label" for="acc-ident">{{ identifierLabel }} <span class="opacity-60">(optional)</span></label>
          <input id="acc-ident" v-model="identifier" type="text" class="input w-full" :placeholder="type === 'home' ? 'Street address' : '17-character VIN'" />
        </fieldset>
        <fieldset v-else class="fieldset">
          <label class="label" for="acc-inst">Institution <span class="opacity-60">(optional)</span></label>
          <input id="acc-inst" v-model="institution" type="text" class="input w-full" placeholder="e.g. Credit union" />
        </fieldset>

        <div v-if="mode === 'create'" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <fieldset class="fieldset">
            <label class="label" for="acc-bal">{{ balanceLabel }}</label>
            <input id="acc-bal" v-model="balance" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" required placeholder="0.00" />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label" for="acc-date">As of</label>
            <input id="acc-date" v-model="asOf" type="date" class="input w-full" required />
          </fieldset>
        </div>

        <div v-if="meta.debt" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <fieldset class="fieldset">
            <label class="label" for="acc-apr">Interest rate (APR %)</label>
            <input id="acc-apr" v-model="apr" type="number" step="0.001" min="0" inputmode="decimal" class="input num w-full" placeholder="21.9" />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label" for="acc-min">Minimum payment</label>
            <input id="acc-min" v-model="minPayment" type="number" step="0.01" min="0" inputmode="decimal" class="input num w-full" placeholder="0.00" />
          </fieldset>
        </div>

        <fieldset v-if="meta.property" class="fieldset">
          <label class="label" for="acc-link">Linked loan <span class="opacity-60">(optional)</span></label>
          <select id="acc-link" v-model="linkedId" class="select w-full">
            <option value="">None (owned outright)</option>
            <option v-for="d in debtOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
          <p class="label whitespace-normal">
            Equity is the estimated value minus the linked loan's latest balance. Add the loan as its own account first.
          </p>
        </fieldset>

        <label v-if="mode === 'edit'" class="label cursor-pointer justify-start gap-3">
          <input v-model="archived" type="checkbox" class="checkbox checkbox-sm" />
          <span>Archive this account (hide it and leave it out of totals; history is kept)</span>
        </label>

        <div class="modal-action mt-2">
          <button type="button" class="btn" @click="dialog?.close()">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            {{ mode === 'create' ? 'Save account' : 'Save changes' }}
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
</template>
