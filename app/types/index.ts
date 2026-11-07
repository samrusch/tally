export type AccountType =
  | 'checking'
  | 'savings'
  | 'investment'
  | 'retirement'
  | 'home'
  | 'vehicle'
  | 'other_asset'
  | 'credit_card'
  | 'loan'
  | 'mortgage'
  | 'other_debt'

export interface Account {
  id: string
  household_id: string
  /** Who created it (null if that person was removed). Contributors can only change what they created. */
  created_by: string | null
  name: string
  type: AccountType
  institution: string | null
  /** Street address for a home, VIN for a vehicle. */
  identifier: string | null
  apr: number | null
  min_payment: number | null
  /** For a home or vehicle: the loan secured against it. */
  linked_account_id: string | null
  archived: boolean
  created_at: string
}

export interface Entry {
  id: string
  account_id: string
  created_by: string | null
  /** ISO date, YYYY-MM-DD */
  entry_date: string
  /** Value of an asset, or amount owed on a debt. */
  balance: number
  /** Deposits made since the previous update (savings, investments, retirement). */
  contribution: number | null
  mileage: number | null
  source: string | null
  note: string | null
}

export interface LineSeries {
  label: string
  data: (number | null)[]
  color: string
  dashed?: boolean
  /** Fill the area down to the next series (used for the gap between value and loan). */
  fillToNext?: boolean
}

export interface Ledger {
  accounts: Account[]
  entries: Entry[]
}

export type Role = 'owner' | 'editor' | 'contributor' | 'viewer'

export interface Member {
  user_id: string
  role: Role
  email: string | null
  created_at: string
}

export interface Invite {
  id: string
  email: string
  role: Exclude<Role, 'owner'>
  created_at: string
}

export interface HouseholdInfo {
  id: string
  name: string
  role: Role
  userId: string
  members: Member[]
  /** Only loaded for the owner. */
  invites: Invite[]
}

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual'

export interface IncomeSource {
  id: string
  household_id: string
  created_by: string | null
  name: string
  /** Take-home pay per period, after taxes. */
  amount: number
  frequency: Frequency
  active: boolean
  note: string | null
}

export type BudgetKind = 'expense' | 'saving' | 'extra_debt'

export interface BudgetItem {
  id: string
  household_id: string
  created_by: string | null
  name: string
  kind: BudgetKind
  category: string
  amount: number
  frequency: Frequency
  /** Can be trimmed when money is tight. */
  flexible: boolean
  active: boolean
  note: string | null
}

export type GoalKind = 'target' | 'retirement'

export interface Goal {
  id: string
  household_id: string
  created_by: string | null
  name: string
  kind: GoalKind
  /** Target goals: the amount wanted (the low end when a range is given). */
  target_amount: number | null
  /** Target goals: top of the range; planning uses this when set. */
  target_amount_high: number | null
  target_date: string | null
  current_age: number | null
  /** current_age was true on this date, so age keeps advancing on its own. */
  age_set_on: string
  target_age: number | null
  /** Retirement: yearly spending wanted, in today's dollars. */
  annual_spending: number | null
  withdrawal_rate: number
  /** Already set aside outside the tracked accounts. */
  saved: number
  linked_account_ids: string[]
  monthly_contribution: number
  /** Expected yearly return in percent. For retirement this is after inflation. */
  expected_return: number
  active: boolean
  note: string | null
}

export type ActivityAction = 'added' | 'changed' | 'deleted'
export type ActivityEntity = 'account' | 'balance' | 'income' | 'budget' | 'goal' | 'member' | 'invite'

export interface ActivityRow {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: ActivityAction
  entity: ActivityEntity
  entity_id: string | null
  label: string | null
  amount: number | null
  detail: string | null
  created_at: string
}
