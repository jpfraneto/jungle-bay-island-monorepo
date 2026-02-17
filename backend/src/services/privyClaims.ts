import type { JWTPayload } from 'jose'

type LinkedAccount = Record<string, unknown>

function parseLinkedAccounts(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function getPrivyLinkedAccounts(
  claims: JWTPayload | Record<string, unknown>,
): LinkedAccount[] {
  const raw = claims.linked_accounts
  const accounts = parseLinkedAccounts(raw)
  return accounts.filter((account): account is LinkedAccount => (
    !!account && typeof account === 'object'
  ))
}
