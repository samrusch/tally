import type { Account, Frequency, IncomeSource } from '~/types'
import type { EntryIndex } from '~/utils/finance'

/** One dated amount on the cash flow calendar. */
export interface CashEvent {
  /** ISO date, YYYY-MM-DD */
  date: string
  kind: 'income' | 'debt'
  name: string
  /** Null when it is a debt payment with no minimum entered yet. */
  amount: number | null
  /** The page where this can be edited. */
  href: string
}

const DAY_MS = 86_400_000

/** Whole days since 1970 for a calendar date, immune to daylight saving shifts. */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/** A date in the given month, with the day clamped to the month's length (the 31st becomes the 30th, or Feb 28). */
function inMonth(year: number, month: number, day: number): string {
  return toISODate(new Date(year, month, Math.min(day, daysInMonth(year, month))))
}

/** Every month (as year and zero-based month) that overlaps [from, to]. */
function monthsBetween(from: Date, to: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  let y = from.getFullYear()
  let m = from.getMonth()
  const endKey = to.getFullYear() * 12 + to.getMonth()
  while (y * 12 + m <= endKey) {
    out.push({ year: y, month: m })
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }
  return out
}

const MONTH_STEP: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, annual: 12 }
const DAY_STEP: Partial<Record<Frequency, number>> = { weekly: 7, biweekly: 14 }

/**
 * The dates a paycheck lands between `from` and `to` (inclusive), repeating a known pay date.
 *   weekly, every two weeks   steps of 7 or 14 days from the known date
 *   monthly, quarterly, annual   the same day of the month (clamped in short months)
 *   twice a month             the known day and the day 15 away from it (the 1st and 16th, or the 15th and 30th)
 */
export function payDates(anchorISO: string, frequency: Frequency, from: Date, to: Date): string[] {
  const anchor = parseISO(anchorISO)
  const fromISO = toISODate(from)
  const toISO = toISODate(to)
  const within = (iso: string) => iso >= fromISO && iso <= toISO

  const dayStep = DAY_STEP[frequency]
  if (dayStep) {
    // Pay dates are anchor + k * step. Find how many days after `from` the first one falls.
    const base = new Date(from.getFullYear(), from.getMonth(), from.getDate())
    const gap = dayNumber(base) - dayNumber(anchor)
    const out: string[] = []
    for (let off = (((-gap % dayStep) + dayStep) % dayStep); ; off += dayStep) {
      const iso = toISODate(addDays(base, off))
      if (iso > toISO) break
      out.push(iso)
    }
    return out
  }

  const months = monthsBetween(from, to)

  if (frequency === 'semimonthly') {
    const d = anchor.getDate()
    const other = d <= 15 ? d + 15 : d - 15
    const out = new Set<string>()
    for (const { year, month } of months) {
      for (const day of [d, other]) {
        const iso = inMonth(year, month, day)
        if (within(iso)) out.add(iso)
      }
    }
    return [...out].sort()
  }

  const step = MONTH_STEP[frequency] ?? 1
  const out: string[] = []
  for (const { year, month } of months) {
    const apart = (year - anchor.getFullYear()) * 12 + (month - anchor.getMonth())
    if (((apart % step) + step) % step !== 0) continue
    const iso = inMonth(year, month, anchor.getDate())
    if (within(iso)) out.push(iso)
  }
  return out
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** The dates a monthly debt payment is due between `from` and `to` (inclusive). */
export function dueDates(paymentDay: number, from: Date, to: Date): string[] {
  const fromISO = toISODate(from)
  const toISO = toISODate(to)
  return monthsBetween(from, to)
    .map(({ year, month }) => inMonth(year, month, paymentDay))
    .filter((iso) => iso >= fromISO && iso <= toISO)
}

export interface CashflowGaps {
  /** Active income with no pay date, so it can't be placed on the calendar. */
  income: IncomeSource[]
  /** Debts with a balance but no due day. */
  debts: Account[]
}

/** Income and debts that still need a date. Paused income and paid-off debts are left out. */
export function missingDates(
  accounts: Account[],
  idx: EntryIndex,
  income: IncomeSource[],
): CashflowGaps {
  return {
    income: income.filter((s) => s.active && s.amount > 0 && !s.next_pay_date),
    debts: accounts.filter(
      (a) => !a.archived && isDebt(a.type) && !a.payment_day && (balanceAt(idx, a.id) ?? 0) > 0,
    ),
  }
}

/**
 * Every paycheck and debt payment between `from` and `to`, in date order (income first on a shared day).
 * Paused income, archived accounts and debts that are paid off are skipped.
 */
export function cashEvents(
  accounts: Account[],
  idx: EntryIndex,
  income: IncomeSource[],
  from: Date,
  to: Date,
): CashEvent[] {
  const events: CashEvent[] = []

  for (const s of income) {
    if (!s.active || !s.next_pay_date) continue
    for (const date of payDates(s.next_pay_date, s.frequency, from, to)) {
      events.push({ date, kind: 'income', name: s.name, amount: s.amount, href: '/budget' })
    }
  }

  for (const a of accounts) {
    if (a.archived || !isDebt(a.type) || !a.payment_day) continue
    if ((balanceAt(idx, a.id) ?? 0) <= 0) continue
    for (const date of dueDates(a.payment_day, from, to)) {
      events.push({ date, kind: 'debt', name: a.name, amount: a.min_payment, href: `/accounts/${a.id}` })
    }
  }

  return events.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === y.kind ? 0 : x.kind === 'income' ? -1 : 1))
}

export interface MonthTotals {
  moneyIn: number
  moneyOut: number
  net: number
  /** Debt payments in the month with no minimum entered, so they're not in `moneyOut`. */
  unknownPayments: number
}

export function totalsOf(events: CashEvent[]): MonthTotals {
  let moneyIn = 0
  let moneyOut = 0
  let unknownPayments = 0
  for (const e of events) {
    if (e.kind === 'income') moneyIn += e.amount ?? 0
    else if (e.amount === null || e.amount <= 0) unknownPayments++
    else moneyOut += e.amount
  }
  return { moneyIn, moneyOut, net: moneyIn - moneyOut, unknownPayments }
}
