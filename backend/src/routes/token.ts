import { Hono } from 'hono'
import { normalizeAddress, toSupportedChain } from '../config'
import { getTokenHolders, getTokenSummary, getTransferTimeline, getHolderBalanceHistory, getTokenRegistry, VALID_TIERS } from '../db/queries'
import { getTierFromHeat } from '../services/heat'
import { logInfo } from '../services/logger'
import { ApiError } from '../services/errors'
import { fetchHolderBalanceHistory } from '../services/scanner'
import { fetchHolderHistory, deriveATA } from '../services/solanaScanner'

const tokenRoute = new Hono()

tokenRoute.get('/token/:chain/:ca/holders', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }
  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  const tierRaw = c.req.query('tier')
  const tier = tierRaw && VALID_TIERS.includes(tierRaw) ? tierRaw : undefined

  const token = await getTokenSummary(tokenAddress)
  if (!token) {
    throw new ApiError(404, 'token_not_found', 'Token not found in registry')
  }

  const { holders, total } = await getTokenHolders(tokenAddress, limit, offset, tier)
  logInfo('TOKEN HOLDERS', `token=${tokenAddress} total=${total} returned=${holders.length} limit=${limit} offset=${offset}`)

  return c.json({
    token,
    holders: holders.map((holder) => {
      const islandHeat = holder.island_heat === null ? null : Number(holder.island_heat)
      return {
        wallet: holder.wallet,
        heat_degrees: Number(holder.heat_degrees),
        farcaster: holder.fid
          ? {
              fid: holder.fid,
              username: holder.username ?? '',
              pfp_url: holder.pfp_url ?? '',
            }
          : undefined,
        island_heat: islandHeat,
        tier: islandHeat === null ? undefined : getTierFromHeat(islandHeat),
      }
    }),
    total,
  })
})

tokenRoute.get('/token/:ca/timeline', async (c) => {
  const tokenAddress = normalizeAddress(c.req.param('ca')) || normalizeAddress(c.req.param('ca'), 'solana')
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const timeline = await getTransferTimeline(tokenAddress)
  return c.json({ timeline })
})

tokenRoute.get('/token/:chain/:ca/holder/:wallet/history', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }
  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }
  const walletParam = c.req.param('wallet') ?? ''
  // Accept both EVM (0x...) and Solana (base58) wallet addresses
  const wallet = chain === 'solana' ? walletParam.trim() : walletParam.toLowerCase()
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }
  if (chain !== 'solana' && !/^0x[0-9a-f]{40}$/.test(wallet)) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const reqStart = Date.now()
  logInfo('HOLDER HISTORY', `chain=${chain} token=${tokenAddress} wallet=${wallet}`)

  // Try DB snapshots first
  const dbSnapshots = await getHolderBalanceHistory(tokenAddress, wallet)
  logInfo('HOLDER HISTORY', `DB query returned ${dbSnapshots.length} snapshots in ${Date.now() - reqStart}ms`)

  if (dbSnapshots.length > 0) {
    // Get token decimals for conversion
    const tokenInfo = await getTokenRegistry(tokenAddress, chain)
    const decimals = tokenInfo?.decimals ?? (chain === 'solana' ? 9 : 18)
    const divisor = 10 ** decimals

    const points = dbSnapshots.map((s) => ({
      t: s.ts,
      b: Number(BigInt(s.balance)) / divisor,
    }))

    // Add current-time point if last snapshot is >1hr old
    const now = Math.floor(Date.now() / 1000)
    if (points.length > 0 && now - points[points.length - 1].t > 3600) {
      points.push({ t: now, b: points[points.length - 1].b })
    }

    logInfo('HOLDER HISTORY', `Serving ${points.length} points from DB (decimals=${decimals}) in ${Date.now() - reqStart}ms`)
    return c.json({ points, decimals })
  }

  // Fallback: for EVM tokens scanned before this feature, use Alchemy
  if (chain !== 'solana') {
    logInfo('HOLDER HISTORY', `No DB snapshots, falling back to Alchemy live fetch`)
    const result = await fetchHolderBalanceHistory(chain, tokenAddress, wallet)
    logInfo('HOLDER HISTORY', `Alchemy fallback returned ${result.points.length} points in ${Date.now() - reqStart}ms`)
    return c.json(result)
  }

  // Fallback: for Solana tokens, use Helius
  logInfo('HOLDER HISTORY', `No DB snapshots for Solana wallet, falling back to Helius`)
  try {
    const tokenInfo = await getTokenRegistry(tokenAddress, chain)
    const decimals = tokenInfo?.decimals ?? 9
    const ata = deriveATA(wallet, tokenAddress)
    const rpcCounter = { count: 0 }
    const snapshots = await fetchHolderHistory(ata, tokenAddress, wallet, rpcCounter)

    if (snapshots.length > 0) {
      const divisor = 10 ** decimals
      const points = snapshots.map((s) => ({
        t: s.ts,
        b: Number(BigInt(s.balance)) / divisor,
      }))
      const now = Math.floor(Date.now() / 1000)
      if (now - points[points.length - 1].t > 3600) {
        points.push({ t: now, b: points[points.length - 1].b })
      }
      logInfo('HOLDER HISTORY', `Helius fallback returned ${points.length} points in ${Date.now() - reqStart}ms`)
      return c.json({ points, decimals })
    }
  } catch (err) {
    logInfo('HOLDER HISTORY', `Helius fallback failed: ${err}`)
  }

  return c.json({ points: [], decimals: 9 })
})

export default tokenRoute
