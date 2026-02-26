import { Hono } from 'hono'
import { normalizeAddress } from '../config'
import { getUserByWallet, getAggregatedUserByWallets, getIdentityClusterByWallet } from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { resolveUserWalletMap } from '../services/identityMap'
import { logInfo } from '../services/logger'
import type { AppEnv } from '../types'

const userRoute = new Hono<AppEnv>()

async function buildCurrentUserResponse(
  wallet: string,
  claims?: Record<string, unknown>,
  identityOverride?: Awaited<ReturnType<typeof resolveUserWalletMap>>,
) {
  const [user, identity] = await Promise.all([
    getUserByWallet(wallet),
    identityOverride
      ? Promise.resolve(identityOverride)
      : resolveUserWalletMap({
          requesterWallet: wallet,
          claims,
          persist: true,
        }),
  ])

  return {
    wallet,
    island_heat: user?.island_heat ?? 0,
    tier: user?.tier ?? 'drifter',
    farcaster: identity.farcaster
      ? {
          fid: identity.farcaster.fid,
          username: identity.farcaster.username,
          display_name: identity.farcaster.display_name,
          pfp_url: identity.farcaster.pfp_url,
        }
      : user?.farcaster ?? null,
    token_breakdown: user?.token_breakdown ?? [],
    scans: user?.scans ?? [],
    connected_wallets: identity.wallets.map((entry) => entry.address),
    wallet_map: identity.wallets,
    wallet_map_summary: identity.summary,
    x_username: identity.x_username,
    farcaster_found: identity.farcaster !== null,
  }
}

userRoute.get('/wallet/:wallet', async (c) => {
  const wallet = normalizeAddress(c.req.param('wallet')) ?? normalizeAddress(c.req.param('wallet'), 'solana')
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const aggregate = c.req.query('aggregate') === 'true'

  if (aggregate) {
    const identity = await getIdentityClusterByWallet(wallet)
    if (identity) {
      const allWallets = identity.wallets.map((w) => w.wallet)
      const aggregated = await getAggregatedUserByWallets(allWallets)
      if (aggregated) {
        logInfo(
          'USER AGGREGATE',
          `wallet=${wallet} linked_wallets=${allWallets.length} identity=${identity.identity_key} tokens=${aggregated.token_breakdown.length}`,
        )
        return c.json({
          wallet,
          ...aggregated,
          linked_wallets: identity.wallets.map((entry) => ({
            wallet: entry.wallet,
            wallet_kind: entry.wallet_kind,
          })),
          x_username: identity.x_username,
          farcaster: identity.farcaster,
          identity_key: identity.identity_key,
          identity_source: identity.identity_source,
          wallet_map: identity.wallets,
          wallet_map_summary: {
            total_wallets: identity.wallets.length,
            evm_wallets: identity.evm_wallets.length,
            solana_wallets: identity.solana_wallets.length,
            farcaster_verified_wallets: identity.wallets.filter((entry) => entry.farcaster_verified).length,
          },
          aggregated: true,
        })
      }
    }
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
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined

  return c.json(await buildCurrentUserResponse(wallet, claims))
})

// Auto-setup profile: Privy-linked accounts + X/Farcaster wallet map
// Idempotent — safe to call on every login
userRoute.post('/me/setup', requireWalletAuth, async (c) => {
  const wallet = c.get('walletAddress')!
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined

  const identity = await resolveUserWalletMap({
    requesterWallet: wallet,
    claims,
    persist: true,
  })

  logInfo(
    'PROFILE SETUP',
    `wallet=${wallet} x=${identity.x_username ?? 'none'} fid=${identity.farcaster?.fid ?? 'none'} ` +
    `wallets=${identity.summary.total_wallets} evm=${identity.summary.evm_wallets} sol=${identity.summary.solana_wallets}`,
  )

  return c.json(await buildCurrentUserResponse(wallet, claims, identity))
})

export default userRoute
