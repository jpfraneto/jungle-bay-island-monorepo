import { Hono } from 'hono'
import { normalizeAddress, toSupportedChain } from '../config'
import { getBungalowOwnerRecord } from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { ensureClaimHeatScan, getClaimWalletHeat, isClaimHeatScannableChain } from '../services/claimHeat'
import { fetchDexScreenerData } from '../services/dexscreener'
import { ApiError } from '../services/errors'
import { resolveUserWalletMap } from '../services/identityMap'
import { logInfo } from '../services/logger'
import type { AppEnv } from '../types'

const MINIMUM_HEAT_TO_CLAIM = 10 // Must hold some tokens

const claimPriceRoute = new Hono<AppEnv>()

// Public: get token data + claim price
claimPriceRoute.get('/claim-price/:chain/:ca', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Unsupported chain. Use "base" or "solana".')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_address', 'Invalid token address')
  }

  // Check if already claimed
  const owner = await getBungalowOwnerRecord(tokenAddress, chain)
  if (owner?.current_owner) {
    throw new ApiError(409, 'already_claimed', 'This bungalow has already been claimed')
  }

  const dexData = await fetchDexScreenerData(tokenAddress, chain)
  if (!dexData) {
    throw new ApiError(404, 'token_not_found', 'Could not find token data on DexScreener')
  }

  const marketCap = dexData.marketCap ?? 0
  const rawPrice = marketCap * 0.001
  const priceUsdc = Math.min(Math.max(rawPrice, 1), 1000)

  logInfo('CLAIM PRICE', `chain=${chain} token=${tokenAddress} mcap=${marketCap} price=${priceUsdc}`)

  return c.json({
    price_usdc: Math.round(priceUsdc * 100) / 100,
    market_cap: marketCap,
    token_name: dexData.tokenName,
    token_symbol: dexData.tokenSymbol,
    image_url: dexData.imageUrl,
    price_usd: dexData.priceUsd,
    liquidity_usd: dexData.liquidityUsd,
    volume_24h: dexData.volume24h,
    minimum_heat: MINIMUM_HEAT_TO_CLAIM,
  })
})

// Authenticated: check user's heat score for a token
// Returns Farcaster profile + verified wallets + heat score
claimPriceRoute.get('/claim-eligibility/:chain/:ca', requireWalletAuth, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Unsupported chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_address', 'Invalid token address')
  }

  const wallet = c.get('walletAddress')!
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined

  const identity = await resolveUserWalletMap({
    requesterWallet: wallet,
    claims,
    persist: true,
  })
  const farcaster = identity.farcaster
  const walletList = identity.evm_wallets
  if (!isClaimHeatScannableChain(chain)) {
    throw new ApiError(400, 'unsupported_chain', 'Claim heat scanning is currently available for Base and Ethereum tokens')
  }

  const scanState = await ensureClaimHeatScan({
    chain,
    tokenAddress,
    requesterWallet: wallet,
    requesterFid: farcaster?.fid ?? null,
    requesterTier: null,
  })

  if (scanState.status === 'scanning') {
    return c.json({
      eligible: false,
      heat: 0,
      minimum_heat: MINIMUM_HEAT_TO_CLAIM,
      wallets_checked: walletList.length,
      farcaster: farcaster
        ? {
            fid: farcaster.fid,
            username: farcaster.username,
            display_name: farcaster.display_name,
            pfp_url: farcaster.pfp_url,
            wallets_found: farcaster.wallets_found,
          }
        : null,
      x_username: identity.x_username,
      wallet_map: identity.wallets,
      wallet_map_summary: identity.summary,
      holdings: [],
      scan_pending: true,
      scan_status: 'scanning',
      scan_id: scanState.scanId,
      estimated_seconds: 120,
    }, 202 as any)
  }

  const { heat, breakdown } = await getClaimWalletHeat(tokenAddress, walletList)

  const eligible = heat >= MINIMUM_HEAT_TO_CLAIM

  logInfo(
    'CLAIM ELIGIBILITY',
    `wallet=${wallet} x=${identity.x_username ?? 'none'} fid=${farcaster?.fid ?? 'none'} ` +
    `token=${tokenAddress} heat=${heat} eligible=${eligible} wallets_checked=${walletList.length}`,
  )

  return c.json({
    eligible,
    heat,
    minimum_heat: MINIMUM_HEAT_TO_CLAIM,
    wallets_checked: walletList.length,
    farcaster: farcaster
      ? {
          fid: farcaster.fid,
          username: farcaster.username,
          display_name: farcaster.display_name,
          pfp_url: farcaster.pfp_url,
          wallets_found: farcaster.wallets_found,
        }
      : null,
    x_username: identity.x_username,
    wallet_map: identity.wallets,
    wallet_map_summary: identity.summary,
    holdings: breakdown.map((h) => ({
      address: h.wallet,
      heat_degrees: h.heat_degrees,
    })),
    scan_pending: false,
    scan_status: 'complete',
    scan_id: null,
  })
})

export default claimPriceRoute
