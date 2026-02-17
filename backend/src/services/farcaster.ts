import { CONFIG } from '../config'

export interface ResolvedFarcaster {
  wallet: string
  fid: number
  username: string
  pfp_url: string
}

interface NeynarUser {
  fid: number
  username: string
  pfp_url: string
}

export async function resolveFarcasterBatch(wallets: string[]): Promise<Map<string, ResolvedFarcaster>> {
  const result = new Map<string, ResolvedFarcaster>()
  if (!CONFIG.NEYNAR_API_KEY || wallets.length === 0) return result

  const url = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${wallets.join(',')}`
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-api-key': CONFIG.NEYNAR_API_KEY,
    },
  })

  if (!response.ok) {
    return result
  }

  const payload = (await response.json()) as Record<string, NeynarUser[]>
  for (const [wallet, users] of Object.entries(payload)) {
    if (users.length === 0) continue
    const primary = users[0]
    result.set(wallet.toLowerCase(), {
      wallet: wallet.toLowerCase(),
      fid: primary.fid,
      username: primary.username,
      pfp_url: primary.pfp_url,
    })
  }

  return result
}
