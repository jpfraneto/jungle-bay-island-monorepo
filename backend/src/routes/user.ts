import { Hono } from 'hono'
import { normalizeAddress } from '../config'
import { getUserByWallet, getWalletsByFid, upsertWalletFarcasterProfile } from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { logInfo } from '../services/logger'
import { extractXUsername, lookupByXUsername } from '../services/neynar'
import type { AppEnv } from '../types'

const userRoute = new Hono<AppEnv>()

userRoute.get('/user/:wallet', async (c) => {
  const wallet = normalizeAddress(c.req.param('wallet'))
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const user = await getUserByWallet(wallet)
  if (!user) {
    throw new ApiError(404, 'user_not_found', 'User not found')
  }

  logInfo(
    'USER',
    `wallet=${wallet} island_heat=${user.island_heat} tokens=${user.token_breakdown.length} scans=${user.scans.length}`,
  )

  return c.json(user)
})

// Get current user's profile (auth required)
// Always returns something for an authed user — never 404s
userRoute.get('/me', requireWalletAuth, async (c) => {
  const wallet = c.get('walletAddress')!

  const user = await getUserByWallet(wallet)

  // Get all connected wallets if user has a FID
  let connectedWallets: string[] = [wallet.toLowerCase()]
  if (user?.farcaster?.fid) {
    const fidWallets = await getWalletsByFid(user.farcaster.fid)
    const walletSet = new Set(fidWallets)
    walletSet.add(wallet.toLowerCase())
    connectedWallets = [...walletSet]
  }

  return c.json({
    wallet,
    island_heat: user?.island_heat ?? 0,
    tier: user?.tier ?? 'drifter',
    farcaster: user?.farcaster ?? null,
    token_breakdown: user?.token_breakdown ?? [],
    scans: user?.scans ?? [],
    connected_wallets: connectedWallets,
  })
})

// Auto-setup profile: X → Farcaster → upsert wallet_farcaster_profiles
// Idempotent — safe to call on every login
userRoute.post('/me/setup', requireWalletAuth, async (c) => {
  const wallet = c.get('walletAddress')!
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined

  // Extract X username from Privy JWT
  const xUsername = claims ? extractXUsername(claims) : null

  let farcaster: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
    ethAddresses: string[]
    solAddresses: string[]
  } | null = null

  if (xUsername) {
    const profile = await lookupByXUsername(xUsername)
    if (profile) {
      farcaster = {
        fid: profile.fid,
        username: profile.username,
        displayName: profile.displayName,
        pfpUrl: profile.pfpUrl,
        ethAddresses: profile.ethAddresses,
        solAddresses: profile.solAddresses,
      }
    }
  }

  // Collect all ETH wallets (Privy embedded + Farcaster verified)
  const ethWallets = new Set<string>()
  ethWallets.add(wallet.toLowerCase())
  if (farcaster) {
    for (const addr of farcaster.ethAddresses) {
      ethWallets.add(addr.toLowerCase())
    }
  }

  // Upsert wallet_farcaster_profiles for each wallet
  if (farcaster) {
    for (const w of ethWallets) {
      await upsertWalletFarcasterProfile(
        w,
        farcaster.fid,
        farcaster.username,
        farcaster.displayName,
        farcaster.pfpUrl,
      )
    }
  }

  logInfo(
    'PROFILE SETUP',
    `wallet=${wallet} x=${xUsername ?? 'none'} fid=${farcaster?.fid ?? 'none'} wallets=${ethWallets.size}`,
  )

  // Return the full profile
  const user = await getUserByWallet(wallet)

  return c.json({
    wallet,
    island_heat: user?.island_heat ?? 0,
    tier: user?.tier ?? 'drifter',
    farcaster: farcaster
      ? {
          fid: farcaster.fid,
          username: farcaster.username,
          display_name: farcaster.displayName,
          pfp_url: farcaster.pfpUrl,
        }
      : null,
    token_breakdown: user?.token_breakdown ?? [],
    scans: user?.scans ?? [],
    connected_wallets: [...ethWallets],
    x_username: xUsername,
    farcaster_found: farcaster !== null,
  })
})

export default userRoute
