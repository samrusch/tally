import type { BudgetItem, BudgetKind, Frequency, IncomeSource } from '~/types'

export const FREQUENCIES: { value: Frequency; label: string; perYear: number }[] = [
  { value: 'weekly', label: 'Every week', perYear: 52 },
  { value: 'biweekly', label: 'Every two weeks', perYear: 26 },
  { value: 'semimonthly', label: 'Twice a month', perYear: 24 },
  { value: 'monthly', label: 'Every month', perYear: 12 },
  { value: 'quarterly', label: 'Every quarter', perYear: 4 },
  { value: 'annual', label: 'Once a year', perYear: 1 },
]

export const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES.map((f) => [f.value, f.label])) as Record<Frequency, string>

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Utilities',
  'Food',
  'Transportation',
  'Insurance',
  'Health',
  'Kids and family',
  'Personal',
  'Subscriptions',
  'Giving',
  'Other',
]
export const SAVING_CATEGORIES = ['Emergency fund', 'Retirement', 'Investing', 'Goals', 'Other']

export const KIND_META: Record<BudgetKind, { label: string; categories: string[] }> = {
  expense: { label: 'Spending', categories: EXPENSE_CATEGORIES },
  saving: { label: 'Savings', categories: SAVING_CATEGORIES },
  extra_debt: { label: 'Extra debt payment', categories: ['Debt'] },
}

/** Converts an amount per period into an average per month. Weekly is 52/12, every two weeks is 26/12. */
export function toMonthly(amount: number, frequency: Frequency): number {
  const perYear = FREQUENCIES.find((f) => f.value === frequency)?.perYear ?? 12
  return (amount * perYear) / 12
}

export interface CategoryRow {
  category: string
  monthly: number
  share: number
  items: { item: BudgetItem; monthly: number }[]
}

export interface Allocation {
  key: 'spending' | 'debt' | 'saving' | 'extra_debt' | 'left'
  label: string
  monthly: number
  share: number
}

export interface BudgetSummary {
  income: number
  expenses: number
  fixed: number
  flexible: number
  debtMinimums: number
  savings: number
  extraDebt: number
  /** Everything spoken for: spending + debt minimums + savings + extra debt payments. */
  committed: number
  /** Income minus everything committed. Negative means the plan overspends. */
  left: number
  /** What is free for extra debt payments: income minus spending, savings and minimums. */
  availableForExtra: number
  /** Planned savings as a share of income, or null with no income. */
  savingsRate: number | null
  /** Savings plus extra debt payments as a share of income. */
  buildRate: number | null
  categories: CategoryRow[]
  allocation: Allocation[]
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export function summarizeBudget(income: IncomeSource[], items: BudgetItem[], debtMinimums: number): BudgetSummary {
  const live = items.filter((i) => i.active)
  const monthlyOf = (i: BudgetItem) => toMonthly(i.amount, i.frequency)
  const inc = sum(income.filter((s) => s.active).map((s) => toMonthly(s.amount, s.frequency)))

  const expenseItems = live.filter((i) => i.kind === 'expense')
  const expenses = sum(expenseItems.map(monthlyOf))
  const flexible = sum(expenseItems.filter((i) => i.flexible).map(monthlyOf))
  const savings = sum(live.filter((i) => i.kind === 'saving').map(monthlyOf))
  const extraDebt = sum(live.filter((i) => i.kind === 'extra_debt').map(monthlyOf))

  const committed = expenses + debtMinimums + savings + extraDebt
  const left = inc - committed
  const share = (v: number) => (inc > 0 ? v / inc : 0)

  const byCat = new Map<string, CategoryRow>()
  for (const item of expenseItems) {
    const row = byCat.get(item.category) ?? { category: item.category, monthly: 0, share: 0, items: [] }
    const m = monthlyOf(item)
    row.monthly += m
    row.items.push({ item, monthly: m })
    byCat.set(item.category, row)
  }
  const categories = [...byCat.values()]
    .map((r) => ({ ...r, share: share(r.monthly), items: r.items.sort((a, b) => b.monthly - a.monthly) }))
    .sort((a, b) => b.monthly - a.monthly)

  const allocation: Allocation[] = [
    { key: 'spending', label: 'Spending', monthly: expenses, share: share(expenses) },
    { key: 'debt', label: 'Debt minimums', monthly: debtMinimums, share: share(debtMinimums) },
    { key: 'saving', label: 'Savings', monthly: savings, share: share(savings) },
    { key: 'extra_debt', label: 'Extra debt payments', monthly: extraDebt, share: share(extraDebt) },
    { key: 'left', label: 'Left to assign', monthly: Math.max(0, left), share: share(Math.max(0, left)) },
  ]

  return {
    income: inc,
    expenses,
    fixed: expenses - flexible,
    flexible,
    debtMinimums,
    savings,
    extraDebt,
    committed,
    left,
    availableForExtra: inc - expenses - savings - debtMinimums,
    savingsRate: inc > 0 ? savings / inc : null,
    buildRate: inc > 0 ? (savings + extraDebt) / inc : null,
    categories,
    allocation,
  }
}

export interface ExtraPaycheck {
  name: string
  amount: number
  /** How many months a year bring one more paycheck than the usual count. */
  months: number
}

/**
 * Weekly and every-two-weeks pay lines up with the calendar so that some months have an extra paycheck
 * (4 months a year for weekly, 2 for every two weeks). Budgeting on the average is safe; the extra checks
 * are a natural boost for debt or savings.
 */
export function extraPaychecks(income: IncomeSource[]): ExtraPaycheck[] {
  return income
    .filter((s) => s.active && s.amount > 0)
    .flatMap((s) =>
      s.frequency === 'biweekly'
        ? [{ name: s.name, amount: s.amount, months: 2 }]
        : s.frequency === 'weekly'
          ? [{ name: s.name, amount: s.amount, months: 4 }]
          : [],
    )
}
