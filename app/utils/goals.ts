import type { Goal } from '~/types'

export const MAX_GOAL_MONTHS = 600
const EPS = 0.005
const DAY = 86_400_000

/** Balance after `months` of adding `monthly` at the end of each month, growing at `annualPct` a year. */
export function growth(balance: number, monthly: number, annualPct: number, months: number): number {
  const i = annualPct / 1200
  if (months <= 0) return balance
  if (Math.abs(i) < 1e-12) return balance + monthly * months
  const f = Math.pow(1 + i, months)
  return balance * f + (monthly * (f - 1)) / i
}

/** The monthly amount that grows `balance` to `target` in `months`. Zero when it gets there on growth alone. */
export function requiredMonthly(balance: number, target: number, annualPct: number, months: number): number | null {
  if (months <= 0) return null
  const i = annualPct / 1200
  if (Math.abs(i) < 1e-12) return Math.max(0, (target - balance) / months)
  const f = Math.pow(1 + i, months)
  const need = target - balance * f
  if (need <= 0) return 0
  return (need * i) / (f - 1)
}

/** Months until the balance reaches `target`, or null if it doesn't within `cap` months. */
export function monthsToReach(balance: number, monthly: number, annualPct: number, target: number, cap = MAX_GOAL_MONTHS): number | null {
  if (balance >= target - EPS) return 0
  const i = annualPct / 1200
  let bal = balance
  for (let m = 1; m <= cap; m++) {
    bal = bal * (1 + i) + monthly
    if (bal >= target - EPS) return m
  }
  return null
}

/** Balance at the end of each month from now (index 0) through `months`. */
export function balanceSeries(balance: number, monthly: number, annualPct: number, months: number): number[] {
  const i = annualPct / 1200
  const out = [balance]
  let bal = balance
  for (let m = 1; m <= months; m++) {
    bal = bal * (1 + i) + monthly
    out.push(bal)
  }
  return out
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** Whole months from `today` to an ISO date (0 when it is today or already past). */
export function monthsUntil(iso: string, today: Date): number {
  return Math.max(0, Math.round((parse(iso).getTime() - today.getTime()) / (DAY * (365.25 / 12))))
}

/** Age today, given an age that was true on `setOn`. */
export function ageNow(age: number, setOn: string, today: Date): number {
  return age + Math.max(0, (today.getTime() - parse(setOn).getTime()) / (DAY * 365.25))
}

export function nestEgg(annualSpending: number, withdrawalPct: number): number {
  return withdrawalPct > 0 ? annualSpending / (withdrawalPct / 100) : 0
}

export interface GoalPlan {
  goal: Goal
  /** Linked account balances plus money already set aside. */
  current: number
  /** What the plan aims for: the top of a range if given; a retirement goal's nest egg. */
  target: number
  /** The low end of a range, when one was given. */
  low: number | null
  progress: number
  /** Months left until the deadline (0 if reached or passed). */
  monthsLeft: number
  deadline: Date | null
  planned: number
  /** Monthly amount needed to hit the target by the deadline. Null when the deadline has passed. */
  required: number | null
  /** Balance at the deadline if the planned amount is saved every month. */
  projected: number
  /** Positive when the plan falls short of the target at the deadline. */
  gap: number
  reached: boolean
  onTrack: boolean
  /** Months until the target is reached at the planned pace, or null if not within 50 years. */
  reachedIn: number | null
  reachedDate: Date | null
  /** Retirement only: the age you reach the nest egg at the planned pace. */
  reachedAge: number | null
  ageNow: number | null
  targetAge: number | null
}

export function addMonthsTo(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** `accountBalance` is the sum of the latest balances of this goal's linked accounts. */
export function planGoal(goal: Goal, accountBalance: number, today: Date): GoalPlan {
  const current = accountBalance + goal.saved
  const rate = goal.expected_return
  const planned = goal.monthly_contribution

  let target = 0
  let low: number | null = null
  let monthsLeft = 0
  let deadline: Date | null = null
  let age: number | null = null

  if (goal.kind === 'retirement') {
    age = ageNow(goal.current_age ?? 0, goal.age_set_on, today)
    target = nestEgg(goal.annual_spending ?? 0, goal.withdrawal_rate)
    monthsLeft = Math.max(0, Math.round(((goal.target_age ?? 0) - age) * 12))
    deadline = addMonthsTo(today, monthsLeft)
  } else {
    target = goal.target_amount_high ?? goal.target_amount ?? 0
    low = goal.target_amount_high !== null && goal.target_amount !== null ? goal.target_amount : null
    monthsLeft = goal.target_date ? monthsUntil(goal.target_date, today) : 0
    deadline = goal.target_date ? parse(goal.target_date) : null
  }

  const reached = current >= target - EPS
  const required = requiredMonthly(current, target, rate, monthsLeft)
  const projected = growth(current, planned, rate, monthsLeft)
  const reachedIn = monthsToReach(current, planned, rate, target)

  return {
    goal,
    current,
    target,
    low,
    progress: target > 0 ? Math.min(1, current / target) : 1,
    monthsLeft,
    deadline,
    planned,
    required,
    projected,
    gap: Math.max(0, target - projected),
    reached,
    onTrack: reached || projected >= target - EPS,
    reachedIn,
    reachedDate: reachedIn === null ? null : addMonthsTo(today, reachedIn),
    reachedAge: goal.kind === 'retirement' && reachedIn !== null && age !== null ? age + reachedIn / 12 : null,
    ageNow: age,
    targetAge: goal.target_age,
  }
}
