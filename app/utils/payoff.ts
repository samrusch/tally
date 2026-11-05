import type { Account } from '~/types'
import type { EntryIndex } from '~/utils/finance'

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export type Strategy = 'avalanche' | 'snowball' | 'minimum'

export interface DebtInput {
  id: string
  name: string
  type: Account['type']
  balance: number
  /** Annual percentage rate, e.g. 21.9. Null when not entered yet. */
  apr: number | null
  /** Required monthly payment. Null when not entered yet. */
  minPayment: number | null
}

export interface SimDebt {
  id: string
  name: string
  balance: number
  apr: number
  min: number
  /** No APR was entered, so 0% is assumed. */
  aprMissing: boolean
  /** No minimum payment was entered, so one was estimated. */
  minEstimated: boolean
}

/** Every debt with a balance, using each account's latest entry. */
export function debtInputs(accounts: Account[], idx: EntryIndex, includeMortgage: boolean): DebtInput[] {
  const out: DebtInput[] = []
  for (const a of accounts) {
    if (!isDebt(a.type)) continue
    if (a.type === 'mortgage' && !includeMortgage) continue
    const balance = balanceAt(idx, a.id) ?? 0
    if (balance <= 0) continue
    out.push({ id: a.id, name: a.name, type: a.type, balance, apr: a.apr, minPayment: a.min_payment })
  }
  return out
}

/**
 * Fills in anything missing so the simulation can run, and flags what was assumed:
 * a missing APR counts as 0%, a missing minimum as the larger of $25 or 2% of the balance.
 */
export function prepareDebts(inputs: DebtInput[]): SimDebt[] {
  return inputs
    .filter((d) => d.balance > 0)
    .map((d) => {
      const minEstimated = !d.minPayment || d.minPayment <= 0
      return {
        id: d.id,
        name: d.name,
        balance: d.balance,
        apr: d.apr ?? 0,
        min: minEstimated ? Math.max(25, Math.round(d.balance * 0.02)) : (d.minPayment as number),
        aprMissing: d.apr === null,
        minEstimated,
      }
    })
}

/* -------------------------------------------------------------------------- */
/* Payoff simulation                                                          */
/* -------------------------------------------------------------------------- */

const MAX_MONTHS = 600
const EPS = 0.005

export interface DebtOutcome {
  id: string
  name: string
  apr: number
  /** Month number (1 = next month) when this debt reaches zero, or null if it never does. */
  paidOffMonth: number | null
  interest: number
}

export interface PayoffResult {
  strategy: Strategy
  /** False when the payments can't beat the interest, so the debt never reaches zero. */
  feasible: boolean
  months: number
  totalInterest: number
  totalPaid: number
  payoffDate: Date | null
  /** Total remaining after each month; index 0 is today. */
  balances: number[]
  perDebt: DebtOutcome[]
}

/**
 * Month-by-month payoff with interest compounding monthly (APR / 12).
 *
 * Every month: interest is added, each debt gets its minimum, and whatever is left of the
 * monthly budget goes to the target debt. The budget is the sum of the original minimums plus
 * `extra`, so as debts are cleared their minimums roll onto the next one (the "snowball" effect).
 *
 * - avalanche: target the highest APR first (least total interest)
 * - snowball: target the smallest balance first (quickest early wins)
 * - minimum: pay only each debt's own minimum, with no extra and no rollover
 */
export function simulatePayoff(debts: SimDebt[], strategy: Strategy, extra = 0, today = new Date()): PayoffResult {
  const state = debts.map((d) => ({ d, bal: d.balance, interest: 0, paidOff: null as number | null }))
  const start = state.reduce((s, x) => s + x.bal, 0)
  const budget = debts.reduce((s, d) => s + d.min, 0) + Math.max(0, extra)
  const balances = [start]
  let months = 0
  let diverged = false

  for (let m = 1; m <= MAX_MONTHS; m++) {
    const active = state.filter((x) => x.bal > EPS)
    if (!active.length) break

    for (const x of active) {
      const i = (x.bal * x.d.apr) / 1200
      x.bal += i
      x.interest += i
    }

    let paid = 0
    for (const x of active) {
      const p = Math.min(x.d.min, x.bal)
      x.bal -= p
      paid += p
    }

    if (strategy !== 'minimum') {
      let left = budget - paid
      const order = active
        .filter((x) => x.bal > EPS)
        .sort(
          strategy === 'avalanche'
            ? (a, b) => b.d.apr - a.d.apr || a.bal - b.bal
            : (a, b) => a.bal - b.bal || b.d.apr - a.d.apr,
        )
      for (const x of order) {
        if (left <= 0) break
        const p = Math.min(left, x.bal)
        x.bal -= p
        left -= p
      }
    }

    for (const x of active) {
      if (x.bal <= EPS) {
        x.bal = 0
        if (x.paidOff === null) x.paidOff = m
      }
    }

    const total = state.reduce((s, x) => s + x.bal, 0)
    balances.push(total)
    months = m
    // Payments that are smaller than the interest make the balance explode; stop early.
    if (total > start * 5) {
      diverged = true
      break
    }
  }

  const remaining = balances[balances.length - 1] ?? 0
  const feasible = !diverged && remaining <= EPS
  const totalInterest = state.reduce((s, x) => s + x.interest, 0)

  return {
    strategy,
    feasible,
    months,
    totalInterest,
    totalPaid: start + totalInterest,
    payoffDate: feasible && months > 0 ? addMonths(today, months) : null,
    balances,
    perDebt: state
      .map((x) => ({ id: x.d.id, name: x.d.name, apr: x.d.apr, paidOffMonth: x.paidOff, interest: x.interest }))
      .sort((a, b) => (a.paidOffMonth ?? Infinity) - (b.paidOffMonth ?? Infinity)),
  }
}

/* -------------------------------------------------------------------------- */
/* Balance transfer comparison                                                */
/* -------------------------------------------------------------------------- */

export interface TransferInput {
  balance: number
  /** What the card charges today (APR %). */
  currentApr: number
  /** What the new card charges once the promo ends (APR %). */
  afterApr: number
  /** What you'd pay each month toward this balance, in either case. */
  payment: number
  /** Transfer fee as a percent of the amount moved, added to the new balance. */
  feePct: number
  promoApr: number
  promoMonths: number
}

interface SingleRun {
  feasible: boolean
  months: number | null
  interest: number
  /** Balance after each month; index 0 is the starting balance. */
  trail: number[]
}

function runSingle(balance: number, aprForMonth: (m: number) => number, payment: number): SingleRun {
  let bal = balance
  let interest = 0
  const trail = [balance]
  for (let m = 1; m <= MAX_MONTHS; m++) {
    if (bal <= EPS) return { feasible: true, months: m - 1, interest, trail }
    const i = (bal * aprForMonth(m)) / 1200
    bal += i
    interest += i
    bal -= Math.min(payment, bal)
    trail.push(bal)
    if (bal > balance * 5) return { feasible: false, months: null, interest, trail }
  }
  return bal <= EPS
    ? { feasible: true, months: MAX_MONTHS, interest, trail }
    : { feasible: false, months: null, interest, trail }
}

export interface TransferResult {
  stay: SingleRun
  move: SingleRun & { fee: number; balanceAfterPromo: number | null }
  /** Positive: transferring saves money overall. Null when one side never pays off. */
  netSavings: number | null
}

export function compareTransfer(i: TransferInput): TransferResult {
  const stay = runSingle(i.balance, () => i.currentApr, i.payment)
  const fee = (i.balance * i.feePct) / 100
  const move = runSingle(i.balance + fee, (m) => (m <= i.promoMonths ? i.promoApr : i.afterApr), i.payment)
  const atPromoEnd = move.trail[Math.min(i.promoMonths, move.trail.length - 1)]
  const netSavings = stay.feasible && move.feasible ? stay.interest - (move.interest + fee) : null
  return { stay, move: { ...move, fee, balanceAfterPromo: atPromoEnd ?? null }, netSavings }
}

/** "3 yr 2 mo", "11 mo" */
export function fmtDuration(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`
}
