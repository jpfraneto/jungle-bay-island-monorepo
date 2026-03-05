import { getPrivyLinkedAccounts } from './privyClaims'

/**
 * Wallet enrichment has been intentionally removed.
 *
 * Jungle Bay now only trusts wallets explicitly linked through Privy SIWE.
 * We still keep this helper to read X usernames from Privy claims, because
 * handle display/linking is now X-only.
 */
export function extractXUsername(privyClaims: Record<string, unknown>): string | null {
  const linkedAccounts = getPrivyLinkedAccounts(privyClaims)

  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    if (candidate.type === 'twitter_oauth' || candidate.type === 'twitter') {
      const username =
        typeof candidate.username === 'string'
          ? candidate.username
          : typeof candidate.screen_name === 'string'
            ? candidate.screen_name
            : ''

      const normalized = username.trim().replace(/^@+/, '').toLowerCase()
      if (normalized) {
        return `@${normalized}`
      }
    }
  }

  return null
}
