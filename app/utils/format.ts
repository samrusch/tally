const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function money(n: number, cents = false): string {
  return (cents ? usd2 : usd0).format(n)
}

export function signedMoney(n: number, cents = false): string {
  if (n === 0) return money(0, cents)
  return (n > 0 ? '+' : '−') + money(Math.abs(n), cents)
}

export function compactMoney(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 1_000) {
    const k = a / 1_000
    // Keep one decimal under $10k so axis ticks like $2.5k and $3k don't both round to "$3k".
    return `${sign}$${k < 10 && k % 1 !== 0 ? k.toFixed(1) : Math.round(k)}k`
  }
  return `${sign}$${Math.round(a)}`
}

/** "2 yr 3 mo", "7 mo" */
export function fmtMonths(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const todayISO = (): string => toISODate(new Date())

const fullDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const dayMonth = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const monthOnly = new Intl.DateTimeFormat('en-US', { month: 'short' })

export function fmtDate(iso: string): string {
  return fullDate.format(parseISO(iso))
}

/** "Oct 31", with a two-digit year when it is not the current year. */
export function shortDate(iso: string): string {
  const d = parseISO(iso)
  const base = dayMonth.format(d)
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} '${String(d.getFullYear()).slice(2)}`
}

export function monthLabel(d: Date, withYear = false): string {
  const m = monthOnly.format(d)
  return withYear ? `${m} '${String(d.getFullYear()).slice(2)}` : m
}

export function monthYear(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d)
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

export function daysSince(iso: string, today = new Date()): number {
  return Math.floor((today.getTime() - parseISO(iso).getTime()) / 86_400_000)
}
