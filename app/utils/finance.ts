import type { Account, AccountType, Entry } from '~/types'

/* -------------------------------------------------------------------------- */
/* Account types                                                              */
/* -------------------------------------------------------------------------- */

export interface TypeMeta {
  label: string
  group: string
  debt: boolean
  /** Home or vehicle: an asset that can have a loan linked to it. */
  property: boolean
  /** Types where you can log deposits so growth can be separated from contributions. */
  contributions: boolean
}

export const TYPE_META: Record<AccountType, TypeMeta> = {
  checking: { label: 'Checking', group: 'Cash', debt: false, property: false, contributions: false },
  savings: { label: 'Savings', group: 'Cash', debt: false, property: false, contributions: true },
  investment: { label: 'Investment', group: 'Investments', debt: false, property: false, contributions: true },
  retirement: { label: 'Retirement', group: 'Retirement', debt: false, property: false, contributions: true },
  home: { label: 'Home', group: 'Property & vehicles', debt: false, property: true, contributions: false },
  vehicle: { label: 'Vehicle', group: 'Property & vehicles', debt: false, property: true, contributions: false },
  other_asset: { label: 'Other asset', group: 'Other assets', debt: false, property: false, contributions: false },
  credit_card: { label: 'Credit card', group: 'Debts', debt: true, property: false, contributions: false },
  loan: { label: 'Loan', group: 'Debts', debt: true, property: false, contributions: false },
  mortgage: { label: 'Mortgage', group: 'Debts', debt: true, property: false, contributions: false },
  other_debt: { label: 'Other debt', group: 'Debts', debt: true, property: false, contributions: false },
}

export const GROUP_ORDER = ['Cash', 'Investments', 'Retirement', 'Property & vehicles', 'Other assets', 'Debts']

export const TYPE_OPTIONS = (Object.keys(TYPE_META) as AccountType[]).map((value) => ({
  value,
  label: TYPE_META[value].label,
  group: TYPE_META[value].debt ? 'Debts (what you owe)' : 'Assets (what you own)',
}))

export const isDebt = (t: AccountType): boolean => TYPE_META[t].debt
export const isProperty = (t: AccountType): boolean => TYPE_META[t].property

/** A fixed palette that reads well in both the light and dark themes. */
export const PALETTE = {
  green: '#2f9e76',
  orange: '#d9662b',
  blue: '#3b7dd8',
  purple: '#7a68b8',
  amber: '#d9a441',
  brown: '#a8714f',
  gray: '#8a968f',
}
const ALLOCATION_COLORS = [PALETTE.purple, PALETTE.green, PALETTE.blue, PALETTE.amber, PALETTE.brown, PALETTE.gray, '#c05a8a']

/* -------------------------------------------------------------------------- */
/* Entry lookups                                                              */
/* -------------------------------------------------------------------------- */

export type EntryIndex = Map<string, Entry[]>

/** Entries grouped by account, each list sorted oldest to newest. */
export function indexEntries(entries: Entry[]): EntryIndex {
  const map: EntryIndex = new Map()
  for (const e of entries) {
    const list = map.get(e.account_id)
    if (list) list.push(e)
    else map.set(e.account_id, [e])
  }
  for (const list of map.values()) list.sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  return map
}

/** The latest entry on or before `date` (or the latest overall when no date is given). */
export function entryAt(idx: EntryIndex, accountId: string, date?: string): Entry | undefined {
  const list = idx.get(accountId)
  if (!list?.length) return undefined
  if (!date) return list[list.length - 1]
  let found: Entry | undefined
  for (const e of list) {
    if (e.entry_date <= date) found = e
    else break
  }
  return found
}

export const balanceAt = (idx: EntryIndex, accountId: string, date?: string): number | null =>
  entryAt(idx, accountId, date)?.balance ?? null

/* -------------------------------------------------------------------------- */
/* Time series                                                                */
/* -------------------------------------------------------------------------- */

export interface TimePoint {
  date: string
  label: string
}

/** The last `count` month-ends, with today standing in for the current month. */
export function monthEndPoints(count: number, today = new Date()): TimePoint[] {
  const withYear = count > 12
  const points: TimePoint[] = []
  for (let i = count - 1; i >= 1; i--) {
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0)
    points.push({ date: toISODate(end), label: monthLabel(end, withYear) })
  }
  points.push({ date: toISODate(today), label: monthLabel(today, withYear) })
  return points
}

export interface Snapshot {
  assets: number
  debts: number
  net: number
  /** Cards and loans, i.e. every debt except the mortgage. */
  nonMortgageDebt: number
}

export function snapshotAt(accounts: Account[], idx: EntryIndex, date?: string): Snapshot {
  let assets = 0
  let debts = 0
  let nonMortgageDebt = 0
  for (const a of accounts) {
    const b = balanceAt(idx, a.id, date) ?? 0
    if (isDebt(a.type)) {
      debts += b
      if (a.type !== 'mortgage') nonMortgageDebt += b
    } else {
      assets += b
    }
  }
  return { assets, debts, net: assets - debts, nonMortgageDebt }
}

export interface SeriesPoint extends Snapshot, TimePoint {
  /** False while no account had any entry yet, so the point would just be zero. */
  hasData: boolean
}

export function netWorthSeries(accounts: Account[], idx: EntryIndex, points: TimePoint[]): SeriesPoint[] {
  return points.map((p) => ({
    ...p,
    ...snapshotAt(accounts, idx, p.date),
    hasData: accounts.some((a) => entryAt(idx, a.id, p.date) !== undefined),
  }))
}

/* -------------------------------------------------------------------------- */
/* Allocation and equity                                                      */
/* -------------------------------------------------------------------------- */

export interface AllocationSlice {
  name: string
  amount: number
  share: number
  color: string
}

export function allocation(accounts: Account[], idx: EntryIndex): AllocationSlice[] {
  const totals = new Map<AccountType, number>()
  for (const a of accounts) {
    if (isDebt(a.type)) continue
    const b = balanceAt(idx, a.id) ?? 0
    if (b > 0) totals.set(a.type, (totals.get(a.type) ?? 0) + b)
  }
  const sum = [...totals.values()].reduce((s, v) => s + v, 0)
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, amount], i) => ({
      name: TYPE_META[type].label,
      amount,
      share: sum > 0 ? amount / sum : 0,
      color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] ?? PALETTE.gray,
    }))
}

export interface EquityRow {
  asset: Account
  loan: Account | null
  value: number
  owed: number
  equity: number
  /** Equity as a share of the asset's value. */
  share: number
}

/** Equity for each home or vehicle: value minus the balance of its linked loan. */
export function equityRows(accounts: Account[], idx: EntryIndex, date?: string): EquityRow[] {
  const rows: EquityRow[] = []
  for (const a of accounts) {
    if (!isProperty(a.type)) continue
    const value = balanceAt(idx, a.id, date)
    if (value === null) continue
    const loan = a.linked_account_id ? (accounts.find((x) => x.id === a.linked_account_id) ?? null) : null
    const owed = loan ? (balanceAt(idx, loan.id, date) ?? 0) : 0
    rows.push({ asset: a, loan, value, owed, equity: value - owed, share: value > 0 ? (value - owed) / value : 0 })
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/* Debt payoff projection                                                     */
/* -------------------------------------------------------------------------- */

export interface Payoff {
  /** Current balance of all cards and loans (mortgage excluded). */
  total: number
  /** Average dollars per month the total has been falling. */
  monthlyPace: number
  /** Whole months until zero at the current pace, or null when it can't be projected. */
  months: number | null
  date: Date | null
  /** True once at least one debt has a month or more of history to measure. */
  measured: boolean
}

const AVG_MONTH_DAYS = 30.4375
const MAX_PROJECTION_MONTHS = 600

/**
 * A deliberately simple projection: it measures how fast each card and loan has
 * fallen over its own history (up to the last 12 months), adds those paces up
 * and runs them forward in a straight line. It ignores interest.
 */
export function projectPayoff(accounts: Account[], idx: EntryIndex, today = new Date(), windowMonths = 12): Payoff {
  const debts = accounts.filter((a) => isDebt(a.type) && a.type !== 'mortgage')
  const limit = toISODate(new Date(today.getFullYear(), today.getMonth() - windowMonths, today.getDate()))
  let total = 0
  let pace = 0
  let measured = false

  for (const a of debts) {
    const list = idx.get(a.id)
    const first = list?.[0]
    const last = list?.[list.length - 1]
    if (!list || !first || !last) continue
    total += last.balance

    const before = entryAt(idx, a.id, limit)
    const startDate = before ? limit : first.entry_date
    const startBalance = before ? before.balance : first.balance
    const months = (today.getTime() - parseISO(startDate).getTime()) / 86_400_000 / AVG_MONTH_DAYS
    if (months >= 1) {
      pace += (startBalance - last.balance) / months
      measured = true
    }
  }

  return finishPayoff(total, pace, measured, today)
}

function finishPayoff(total: number, pace: number, measured: boolean, today: Date): Payoff {
  if (total <= 0) return { total, monthlyPace: pace, months: 0, date: null, measured }
  if (!measured || pace <= 0) return { total, monthlyPace: pace, months: null, date: null, measured }
  const months = Math.ceil(total / pace)
  if (months > MAX_PROJECTION_MONTHS) return { total, monthlyPace: pace, months: null, date: null, measured }
  return { total, monthlyPace: pace, months, date: addMonths(today, months), measured }
}

/** When would the debt be gone if you paid `extra` more per month? */
export function payoffWithExtra(p: Payoff, extra: number, today = new Date()): Payoff {
  return finishPayoff(p.total, p.monthlyPace + extra, true, today)
}

/* -------------------------------------------------------------------------- */
/* Contributions                                                              */
/* -------------------------------------------------------------------------- */

/** Total deposits logged per month across all asset accounts. */
export function monthlyContributions(accounts: Account[], entries: Entry[], points: TimePoint[]): number[] {
  const assetIds = new Set(accounts.filter((a) => !isDebt(a.type)).map((a) => a.id))
  const totals = new Map<string, number>()
  for (const e of entries) {
    if (!assetIds.has(e.account_id) || !e.contribution) continue
    const key = e.entry_date.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + e.contribution)
  }
  return points.map((p) => totals.get(p.date.slice(0, 7)) ?? 0)
}

/* -------------------------------------------------------------------------- */
/* Insights                                                                   */
/* -------------------------------------------------------------------------- */

export interface Insight {
  tag: string
  tone: 'good' | 'warn' | 'info'
  text: string
}

const STALE_AFTER_DAYS = 35

export function buildInsights(accounts: Account[], idx: EntryIndex, today = new Date()): Insight[] {
  const out: Insight[] = []
  if (!accounts.length) return out
  const limit = toISODate(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()))

  // Net worth trend
  const series = netWorthSeries(accounts, idx, monthEndPoints(12, today)).filter((p) => p.hasData)
  const firstPoint = series[0]
  const lastPoint = series[series.length - 1]
  if (firstPoint && lastPoint && series.length >= 2) {
    // Compare like with like: only accounts that were already being tracked at the start,
    // so adding a new account later doesn't look like growth.
    const tracked = accounts.filter((a) => entryAt(idx, a.id, firstPoint.date) !== undefined)
    const change = snapshotAt(tracked, idx).net - snapshotAt(tracked, idx, firstPoint.date).net
    const caveat = tracked.length < accounts.length ? ' (counting only accounts you were tracking then)' : ''
    out.push({
      tag: 'Net worth',
      tone: change >= 0 ? 'good' : 'warn',
      text: `Net worth is ${change >= 0 ? 'up' : 'down'} ${money(Math.abs(change))} since ${firstPoint.label}${caveat}, and is now ${money(lastPoint.net)}.`,
    })
  } else {
    out.push({
      tag: 'Getting started',
      tone: 'info',
      text: 'Add a second balance update to any account and trends will start to appear here.',
    })
  }

  // Debt payoff
  const hasLoans = accounts.some((a) => isDebt(a.type) && a.type !== 'mortgage')
  if (hasLoans) {
    const p = projectPayoff(accounts, idx, today)
    if (p.total <= 0) {
      out.push({ tag: 'Debt', tone: 'good', text: 'Your cards and loans are all paid off. Nice work.' })
    } else if (p.months !== null && p.date) {
      const faster = payoffWithExtra(p, 300, today)
      const extra =
        faster.date && faster.months !== null && faster.months < p.months
          ? ` Adding $300 a month would move that to about ${monthYear(faster.date)}.`
          : ''
      out.push({
        tag: 'Debt',
        tone: 'good',
        text: `You are paying down about ${money(p.monthlyPace)} a month on cards and loans. At that pace you are debt-free around ${monthYear(p.date)}.${extra}`,
      })
    } else if (p.measured) {
      out.push({
        tag: 'Debt',
        tone: 'warn',
        text: 'Your cards and loans have not gone down over the past year, so a payoff date cannot be projected yet.',
      })
    } else {
      out.push({
        tag: 'Debt',
        tone: 'info',
        text: 'Keep updating your card and loan balances. After a month of history Tally can project a payoff date.',
      })
    }
  }

  // Investments and retirement: growth vs. deposits over the last 12 months
  let invChange = 0
  let invContrib = 0
  let invCount = 0
  for (const a of accounts) {
    if (a.type !== 'investment' && a.type !== 'retirement') continue
    const list = idx.get(a.id)
    const first = list?.[0]
    const last = list?.[list.length - 1]
    if (!list || !first || !last || list.length < 2) continue
    const before = entryAt(idx, a.id, limit)
    const startDate = before ? limit : first.entry_date
    const startBalance = before ? before.balance : first.balance
    invChange += last.balance - startBalance
    invContrib += list.filter((e) => e.entry_date > startDate).reduce((s, e) => s + (e.contribution ?? 0), 0)
    invCount++
  }
  if (invCount > 0) {
    if (invContrib > 0) {
      const growth = invChange - invContrib
      out.push({
        tag: 'Investments',
        tone: invChange >= 0 ? 'good' : 'warn',
        text: `Investment and retirement accounts changed by ${signedMoney(invChange)} over the past year: ${money(invContrib)} from deposits you logged and ${signedMoney(growth)} from market movement.`,
      })
    } else {
      out.push({
        tag: 'Investments',
        tone: invChange >= 0 ? 'good' : 'warn',
        text: `Investment and retirement accounts changed by ${signedMoney(invChange)} over the past year. Log deposits when you update a balance to see how much of that is growth.`,
      })
    }
  }

  // Equity
  for (const row of equityRows(accounts, idx)) {
    const list = idx.get(row.asset.id)
    const firstEntry = list?.[0]
    const lastEntry = list?.[list.length - 1]
    if (!firstEntry || !lastEntry || list.length < 2) continue

    // Look back a year, or to the first entry when the account is younger than that.
    const hasYear = entryAt(idx, row.asset.id, limit) !== undefined
    const from = hasYear ? limit : firstEntry.entry_date
    const valueThen = balanceAt(idx, row.asset.id, from) ?? firstEntry.balance
    let owedThen = 0
    if (row.loan) {
      const loanList = idx.get(row.loan.id)
      owedThen = balanceAt(idx, row.loan.id, from) ?? loanList?.[0]?.balance ?? 0
    }
    const valueChange = row.value - valueThen
    const paydown = owedThen - row.owed
    const total = row.equity - (valueThen - owedThen)
    const span = hasYear ? 'over the past year' : `since ${shortDate(from)}`
    out.push({
      tag: 'Equity',
      tone: total >= 0 ? 'good' : 'warn',
      text: `${row.asset.name} equity is ${total >= 0 ? 'up' : 'down'} ${money(Math.abs(total))} ${span}: ${signedMoney(valueChange)} from its value${row.loan ? ` and ${signedMoney(paydown)} from loan paydown` : ''}.`,
    })
  }

  // Stale accounts
  const stale = accounts.filter((a) => {
    const last = entryAt(idx, a.id)
    return !last || daysSince(last.entry_date, today) > STALE_AFTER_DAYS
  })
  if (stale.length) {
    const names = stale.slice(0, 3).map((a) => a.name).join(', ')
    const more = stale.length > 3 ? ` and ${stale.length - 3} more` : ''
    out.push({
      tag: 'Update due',
      tone: 'warn',
      text: `${stale.length === 1 ? '1 account has' : `${stale.length} accounts have`} not been updated in over a month: ${names}${more}.`,
    })
  }

  return out
}
