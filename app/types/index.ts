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
