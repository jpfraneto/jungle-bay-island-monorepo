import { Hono } from 'hono'
import { normalizeAddress, toSupportedChain } from '../config'
import { getBungalowOwnerRecord } from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { fetchDexScreenerData } from '../services/dexscreener'
import { calculateUserHeat } from '../services/holdings'
import { extractXUsername, lookupByXUsername } from '../services/neynar'
import { ApiError } from '../services/errors'
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

  // Extract X username from Privy JWT
  const xUsername = claims ? extractXUsername(claims) : null

  // Lookup Farcaster profile via Neynar
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

  // Collect all wallets to check (Farcaster verified + Privy embedded)
  const ethWallets = new Set<string>()
  ethWallets.add(wallet.toLowerCase())
  if (farcaster) {
    for (const addr of farcaster.ethAddresses) {
      ethWallets.add(addr.toLowerCase())
    }
  }

  const solWallets = farcaster?.solAddresses ?? []

  // Calculate heat from on-chain holdings
  const { heat, totalBalance, holdings } = await calculateUserHeat(
    tokenAddress,
    chain,
    [...ethWallets],
    solWallets,
  )

  const eligible = heat >= MINIMUM_HEAT_TO_CLAIM

  logInfo(
    'CLAIM ELIGIBILITY',
    `wallet=${wallet} x=${xUsername ?? 'none'} fid=${farcaster?.fid ?? 'none'} ` +
    `token=${tokenAddress} heat=${heat} eligible=${eligible} wallets_checked=${ethWallets.size}`,
  )

  return c.json({
    eligible,
    heat,
    minimum_heat: MINIMUM_HEAT_TO_CLAIM,
    total_balance: totalBalance.toString(),
    wallets_checked: ethWallets.size,
    farcaster: farcaster
      ? {
          fid: farcaster.fid,
          username: farcaster.username,
          display_name: farcaster.displayName,
          pfp_url: farcaster.pfpUrl,
          wallets_found: farcaster.ethAddresses.length + farcaster.solAddresses.length,
        }
      : null,
    x_username: xUsername,
    holdings: holdings.map((h) => ({
      address: h.address,
      balance: h.balance.toString(),
    })),
  })
})

export default claimPriceRoute
