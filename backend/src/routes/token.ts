import { Hono } from 'hono'
import { normalizeAddress, toSupportedChain } from '../config'
import { getTokenHolders, getTokenSummary, getTransferTimeline, VALID_TIERS } from '../db/queries'
import { getTierFromHeat } from '../services/heat'
import { logInfo } from '../services/logger'
import { ApiError } from '../services/errors'
import { fetchHolderBalanceHistory } from '../services/scanner'

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
  if (!chain || chain === 'solana') {
    throw new ApiError(400, 'unsupported_chain', 'Balance history is only available for EVM tokens')
  }
  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }
  const wallet = c.req.param('wallet')?.toLowerCase()
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  logInfo('HOLDER HISTORY', `chain=${chain} token=${tokenAddress} wallet=${wallet}`)
  const result = await fetchHolderBalanceHistory(chain, tokenAddress, wallet)
  return c.json(result)
})

export default tokenRoute
