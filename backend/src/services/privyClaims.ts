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

export function extractPrivyXUsernameFromLinkedAccounts(
  linkedAccounts: LinkedAccount[],
): string | null {
  for (const account of linkedAccounts) {
    const type = typeof account.type === 'string' ? account.type : ''
    if (type !== 'twitter_oauth' && type !== 'twitter') {
      continue
    }

    const rawUsername =
      typeof account.username === 'string'
        ? account.username
        : typeof account.screen_name === 'string'
          ? account.screen_name
          : ''
    const normalized = rawUsername.trim().replace(/^@+/, '').toLowerCase()
    if (normalized) {
      return `@${normalized}`
    }
  }

  return null
}

export function extractPrivyXUsername(
  claims: JWTPayload | Record<string, unknown>,
): string | null {
  return extractPrivyXUsernameFromLinkedAccounts(getPrivyLinkedAccounts(claims))
}
