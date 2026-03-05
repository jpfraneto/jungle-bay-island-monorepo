import { Hono } from 'hono'
import { normalizeAddress } from '../config'
import {
  clearUserXUsername,
  getAggregatedUserByWallets,
  getUserByWallet,
  getUserByWalletAddress,
  getUserByXUsername,
  getUserWallets,
  upsertUser,
} from '../db/queries'
import { requirePrivyAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { logInfo, logWarn } from '../services/logger'
import { getPrivyLinkedAccounts } from '../services/privyClaims'
import type { AppEnv } from '../types'

const userRoute = new Hono<AppEnv>()

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, '').toLowerCase()
  return clean ? `@${clean}` : ''
}

function getPrivyUserIdFromClaims(claims: Record<string, unknown> | undefined): string {
  const privyUserId = typeof claims?.sub === 'string' ? claims.sub.trim() : ''
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy user id missing from token')
  }
  return privyUserId
}

function getEmailFromClaims(claims: Record<string, unknown> | undefined): string | null {
  if (!claims) return null

  const linkedAccounts = getPrivyLinkedAccounts(claims)
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    if (candidate.type !== 'email') continue
    const email = typeof candidate.address === 'string' ? candidate.address.trim().toLowerCase() : ''
    if (email) {
      return email
    }
  }

  return null
}

function buildWalletMap(wallets: string[], requesterWallet: string) {
  return wallets.map((wallet) => ({
    wallet,
    wallet_kind: normalizeAddress(wallet) ? 'evm' : 'solana',
    linked_via_privy: true,
    linked_via_farcaster: false,
    farcaster_verified: false,
    is_requester_wallet: wallet === requesterWallet,
  }))
}

userRoute.get('/wallet/:wallet', async (c) => {
  const wallet = normalizeAddress(c.req.param('wallet')) ?? normalizeAddress(c.req.param('wallet'), 'solana')
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const aggregate = c.req.query('aggregate') === 'true'

  if (aggregate) {
    const owner = await getUserByWalletAddress(wallet)
    const linkedWalletRows = owner
      ? await getUserWallets(owner.privy_user_id)
      : []

    const linkedWallets = linkedWalletRows.length > 0
      ? linkedWalletRows.map((row) => row.address)
      : [wallet]

    const aggregated = await getAggregatedUserByWallets(linkedWallets)

    logInfo(
      'USER AGGREGATE',
      `wallet=${wallet} linked_wallets=${linkedWallets.length} owner=${owner?.privy_user_id ?? 'none'} tokens=${aggregated?.token_breakdown.length ?? 0}`,
    )

    const walletMap = buildWalletMap(linkedWallets, wallet)

    return c.json({
      wallet,
      island_heat: aggregated?.island_heat ?? 0,
      tier: aggregated?.tier ?? 'drifter',
      token_breakdown: aggregated?.token_breakdown ?? [],
      scans: aggregated?.scans ?? [],
      linked_wallets: linkedWallets,
      x_username: owner?.x_username ?? null,
      farcaster: null,
      identity_key: owner ? `privy:${owner.privy_user_id}` : `wallet:${wallet}`,
      identity_source: owner ? 'privy' : 'wallet',
      wallet_map: walletMap,
      wallet_map_summary: {
        total_wallets: linkedWallets.length,
        evm_wallets: walletMap.filter((entry) => entry.wallet_kind === 'evm').length,
        solana_wallets: walletMap.filter((entry) => entry.wallet_kind === 'solana').length,
        farcaster_verified_wallets: 0,
      },
      aggregated: true,
    })
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

userRoute.get('/me', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = getPrivyUserIdFromClaims(claims)
  const email = getEmailFromClaims(claims)

  await upsertUser(privyUserId, {
    email: email ?? undefined,
  })

  const wallets = await getUserWallets(privyUserId)

  return c.json({
    privy_user_id: privyUserId,
    email,
    wallets,
  })
})

userRoute.post('/me/setup', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = getPrivyUserIdFromClaims(claims)
  const email = getEmailFromClaims(claims)

  const user = await upsertUser(privyUserId, {
    email: email ?? undefined,
  })

  const wallets = await getUserWallets(privyUserId)

  return c.json({
    success: true,
    privy_user_id: privyUserId,
    email: user.email,
    x_username: user.x_username,
    wallets,
  })
})

userRoute.post('/user/link-x', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = getPrivyUserIdFromClaims(claims)
  const email = getEmailFromClaims(claims)

  if (!email) {
    throw new ApiError(
      403,
      'invalid_link_x',
      'X-login accounts are already verified and cannot link a secondary X handle',
    )
  }

  const body = await c.req.json<{ x_username?: unknown }>()
  const rawUsername = typeof body.x_username === 'string' ? body.x_username : ''
  const xUsername = normalizeXUsername(rawUsername)

  if (!xUsername) {
    throw new ApiError(400, 'invalid_x_username', 'x_username is required')
  }

  const existing = await getUserByXUsername(xUsername)
  if (existing && existing.privy_user_id !== privyUserId) {
    logWarn(
      'X DUPLICATE',
      `conflict username=${xUsername} current_user=${privyUserId} existing_user=${existing.privy_user_id}`,
    )

    return c.json(
      {
        error: 'duplicate_x_account',
        message: 'This X account is already linked to another profile.',
      },
      409 as any,
    )
  }

  await upsertUser(privyUserId, {
    email: email ?? undefined,
    x_username: xUsername,
  })

  return c.json({
    success: true,
    x_username: xUsername,
  })
})

userRoute.post('/user/unlink-x', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = getPrivyUserIdFromClaims(claims)

  await clearUserXUsername(privyUserId)

  return c.json({
    success: true,
  })
})

export default userRoute
