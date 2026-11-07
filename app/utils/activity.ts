import type { ActivityRow } from '~/types'

export interface ActivityLine {
  /** "You", or the person's name taken from their email. */
  who: string
  /** What they did, e.g. "updated Brokerage balance to $102,000". */
  text: string
  /** Where to go to see it; null when it no longer exists or has no page. */
  href: string | null
}

const ROLES: Record<string, string> = { owner: 'an owner', editor: 'an editor', contributor: 'a contributor', viewer: 'a viewer' }
const EVERY: Record<string, string> = {
  weekly: 'weekly', biweekly: 'every 2 weeks', semimonthly: 'twice a month',
  monthly: 'monthly', quarterly: 'quarterly', annual: 'yearly',
}

/** "sam.rusch@gmail.com" -> "Sam" */
export function nameFromEmail(email: string | null): string {
  if (!email) return 'Someone'
  const first = email.split('@')[0]?.split(/[._+-]/)[0] ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Someone'
}

function dollars(n: number | null): string {
  return n === null ? '' : money(n)
}

export function activityLine(r: ActivityRow, meId: string | null | undefined): ActivityLine {
  const who = meId && r.actor_id === meId ? 'You' : nameFromEmail(r.actor_email)
  const name = r.label || 'an item'
  const verb = r.action === 'added' ? 'added' : r.action === 'changed' ? 'updated' : 'deleted'
  const amt = dollars(r.amount)
  const per = r.detail && EVERY[r.detail] ? `${amt} ${EVERY[r.detail]}` : amt
  const gone = r.action === 'deleted'

  switch (r.entity) {
    case 'account':
      return { who, text: `${verb} the account ${name}`, href: gone || !r.entity_id ? null : `/accounts/${r.entity_id}` }
    case 'balance': {
      const href = r.entity_id ? `/accounts/${r.entity_id}` : null
      if (r.action === 'added') return { who, text: `recorded ${name} at ${amt}`, href }
      if (r.action === 'changed') return { who, text: `updated ${name} to ${amt}`, href }
      return { who, text: `removed a balance entry from ${name}`, href }
    }
    case 'income':
      return { who, text: `${verb} income ${name} (${per})`, href: '/budget' }
    case 'budget':
      return { who, text: `${verb} the budget item ${name} (${per})`, href: '/budget' }
    case 'goal':
      return { who, text: `${verb} the goal ${name}`, href: gone ? null : '/goals' }
    case 'member': {
      const role = ROLES[r.detail ?? ''] ?? 'a member'
      if (r.action === 'added') return { who: r.label || 'Someone', text: `joined as ${role}`, href: '/members' }
      if (r.action === 'changed') return { who, text: `made ${r.label ?? 'someone'} ${role}`, href: '/members' }
      return { who, text: `removed ${r.label ?? 'someone'} from the household`, href: '/members' }
    }
    case 'invite':
      return { who, text: `invited ${r.label ?? 'someone'} as ${ROLES[r.detail ?? ''] ?? 'a member'}`, href: '/members' }
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "Oct 12" */
export function timeAgo(iso: string, now = new Date()): string {
  const t = new Date(iso)
  const mins = Math.floor((now.getTime() - t.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}
