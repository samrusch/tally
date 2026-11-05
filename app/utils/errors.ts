/** Turns a Supabase/Postgres error into something a person can act on. */
export function friendlyError(e: unknown, fallback = 'Something went wrong'): string {
  const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  if (!message) return fallback
  if (/row-level security|permission denied/i.test(message)) {
    return "You don't have permission to do that. Ask the owner to change your role."
  }
  return message
}
