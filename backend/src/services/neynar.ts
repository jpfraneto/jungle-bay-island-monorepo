import { CONFIG } from '../config'
import { getCached, setCached } from './cache'
import { logError, logInfo } from './logger'

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster'
const CACHE_MS = 10 * 60 * 1000 // 10 minutes

export interface NeynarProfile {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  ethAddresses: string[]
  solAddresses: string[]
  score: number
}

interface NeynarUserResponse {
  users: Array<{
    fid: number
    username: string
    display_name: string
    pfp_url: string
    verified_addresses: {
      eth_addresses: string[]
      sol_addresses: string[]
    }
    verified_accounts: Array<{
      platform: string
      username: string
    }>
    score?: number
    experimental?: { neynar_user_score?: number }
  }>
}

/**
 * Look up a Farcaster user by their X (Twitter) username via Neynar.
 * Returns profile with all verified wallet addresses.
 */
export async function lookupByXUsername(xUsername: string): Promise<NeynarProfile | null> {
  if (!CONFIG.NEYNAR_API_KEY) {
    logInfo('NEYNAR', 'No NEYNAR_API_KEY configured, skipping lookup')
    return null
  }

  const cleanUsername = xUsername.replace(/^@/, '').trim().toLowerCase()
  if (!cleanUsername) return null

  const cacheKey = `neynar:x:${cleanUsername}`
  const cached = getCached<NeynarProfile>(cacheKey)
  if (cached) return cached

  try {
    const url = `${NEYNAR_BASE}/user/by_username?username=${encodeURIComponent(cleanUsername)}`
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': CONFIG.NEYNAR_API_KEY,
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      // Try the search-by-x endpoint instead
      return await searchByXUsername(cleanUsername)
    }

    const data = await res.json() as { user: NeynarUserResponse['users'][0] }
    if (!data.user) return await searchByXUsername(cleanUsername)

    const user = data.user
    // Verify this user actually has the X account linked
    const hasX = user.verified_accounts?.some(
      (a) => a.platform === 'x' && a.username.toLowerCase() === cleanUsername
    )

    if (!hasX) {
      // Username matched on Farcaster but not X-linked, try search
      return await searchByXUsername(cleanUsername)
    }

    const profile = toProfile(user)
    setCached(cacheKey, profile, CACHE_MS)
    return profile
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    logError('NEYNAR', `lookupByXUsername failed for ${cleanUsername}: ${msg}`)
    return null
  }
}

/**
 * Search Neynar for a user by their verified X username.
 */
async function searchByXUsername(xUsername: string): Promise<NeynarProfile | null> {
  if (!CONFIG.NEYNAR_API_KEY) return null

  try {
    // Use the lookup-users-by-x endpoint (v2)
    const url = `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(xUsername)}`

    // Actually, let's use the bulk search approach: search by username and filter
    const searchUrl = `${NEYNAR_BASE}/user/search?q=${encodeURIComponent(xUsername)}&limit=5`
    const res = await fetch(searchUrl, {
      headers: {
        accept: 'application/json',
        'x-api-key': CONFIG.NEYNAR_API_KEY,
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null

    const data = await res.json() as { result: { users: NeynarUserResponse['users'] } }
    const users = data.result?.users ?? []

    // Find the user with matching X verification
    const match = users.find((u) =>
      u.verified_accounts?.some(
        (a) => a.platform === 'x' && a.username.toLowerCase() === xUsername.toLowerCase()
      )
    )

    if (!match) return null

    const profile = toProfile(match)
    const cacheKey = `neynar:x:${xUsername.toLowerCase()}`
    setCached(cacheKey, profile, CACHE_MS)
    return profile
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    logError('NEYNAR', `searchByXUsername failed for ${xUsername}: ${msg}`)
    return null
  }
}

function toProfile(user: NeynarUserResponse['users'][0]): NeynarProfile {
  return {
    fid: user.fid,
    username: user.username,
    displayName: user.display_name,
    pfpUrl: user.pfp_url,
    ethAddresses: (user.verified_addresses?.eth_addresses ?? []).map((a) => a.toLowerCase()),
    solAddresses: user.verified_addresses?.sol_addresses ?? [],
    score: user.score ?? user.experimental?.neynar_user_score ?? 0,
  }
}

/**
 * Extract X (Twitter) username from Privy JWT claims.
 * Privy stores linked accounts in the JWT payload.
 */
export function extractXUsername(privyClaims: Record<string, unknown>): string | null {
  const linkedAccounts = Array.isArray(privyClaims.linked_accounts)
    ? privyClaims.linked_accounts
    : []

  for (const account of linkedAccounts) {
    if (!account || typeof account !== 'object') continue
    const candidate = account as Record<string, unknown>
    if (candidate.type === 'twitter_oauth' || candidate.type === 'twitter') {
      if (typeof candidate.username === 'string') return candidate.username
      if (typeof candidate.screen_name === 'string') return candidate.screen_name
    }
  }

  return null
}
