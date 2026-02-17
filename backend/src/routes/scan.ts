import { Hono } from 'hono'
import { CONFIG, normalizeAddress, toSupportedChain } from '../config'
import {
  createScanLog,
  getDailyAllowanceUsed,
  getLatestScanByToken,
  getScanLog,
  getTokenRegistry,
  getViewerProfile,
  incrementDailyAllowance,
  markScanFailed,
  setTokenStatus,
  updateBungalowMetadata,
  writeScanResult,
} from '../db/queries'
import { fetchDexScreenerData } from '../services/dexscreener'
import { requireWalletAuth } from '../middleware/auth'
import { createRateLimit } from '../middleware/rateLimit'
import { ApiError } from '../services/errors'
import { logError, logEvent, logInfo, logSuccess } from '../services/logger'
import { scanToken } from '../services/scanner'
import type { AppEnv } from '../types'

const scanRoute = new Hono<AppEnv>()

const scanBurstLimit = createRateLimit({
  limit: 20,
  windowMs: 60 * 1000,
  keyGenerator: (c) => c.get('walletAddress') ?? 'anon',
})

scanRoute.post('/scan/:chain/:ca', requireWalletAuth, scanBurstLimit, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  const tokenAddress = normalizeAddress(c.req.param('ca'))
  const requester = c.get('walletAddress')

  if (!chain || !tokenAddress || !requester) {
    throw new ApiError(400, 'invalid_params', 'Invalid scan parameters')
  }
  if (chain === 'solana') {
    throw new ApiError(400, 'unsupported_chain', 'Token scanning is not yet available for Solana')
  }
  logInfo('SCAN REQUEST', `wallet=${requester} chain=${chain} token=${tokenAddress}`)

  const registry = await getTokenRegistry(tokenAddress, chain)
  if (registry?.scan_status === 'complete') {
    return c.json({
      status: 'already_exists',
    })
  }

  if (registry?.scan_status === 'scanning') {
    const latest = await getLatestScanByToken(tokenAddress)
    return c.json({
      status: 'scanning',
      scan_id: latest?.id,
    })
  }

  const profile = await getViewerProfile(requester)
  const islandHeat = profile?.islandHeat ?? 0
  const isResidentPlus = islandHeat >= 80

  const today = new Date().toISOString().slice(0, 10)
  if (isResidentPlus) {
    const scansUsed = await getDailyAllowanceUsed(requester, today)
    logInfo('SCAN GATE', `wallet=${requester} tier=${profile?.tier ?? 'Drifter'} scans_used_today=${scansUsed}`)
    if (scansUsed >= CONFIG.RESIDENT_DAILY_SCANS) {
      throw new ApiError(429, 'daily_limit_reached', 'Daily free scan allowance reached')
    }
  } else {
    const paymentProof = c.req.header('X-Payment-Proof')
    if (!paymentProof) {
      throw new ApiError(402, 'payment_required', 'x402 payment is required for non-residents')
    }
    // x402 verification intentionally stubbed for now.
    throw new ApiError(402, 'payment_required', 'x402 verification not implemented yet')
  }

  await setTokenStatus(tokenAddress, chain, 'scanning')

  const scanId = await createScanLog({
    tokenAddress,
    chain,
    requestedBy: requester,
    requesterFid: profile?.fid ?? null,
    requesterTier: profile?.tier ?? null,
    paymentMethod: 'free_resident',
    paymentAmount: 0,
  })

  await incrementDailyAllowance(requester, today)
  logEvent('SCAN STARTED', `scan_id=${scanId} wallet=${requester} token=${tokenAddress}`)

  void (async () => {
    try {
      const result = await scanToken(chain, tokenAddress, (progress) => {
        logInfo('SCAN PROGRESS', `scan_id=${scanId} token=${tokenAddress} phase=${progress.phase} pct=${progress.pct}`)
      })
      await writeScanResult(scanId, result)
      logSuccess(
        'SCAN COMPLETE',
        `scan_id=${scanId} token=${tokenAddress} holders=${result.holderCount} events=${result.eventsFetched} rpc_calls=${result.rpcCallsMade}`,
      )

      // Enrich bungalow with DexScreener metadata (non-blocking)
      try {
        const dexData = await fetchDexScreenerData(tokenAddress, chain)
        if (dexData) {
          await updateBungalowMetadata(tokenAddress, dexData)
          logSuccess('DEXSCREENER ENRICHMENT', `scan_id=${scanId} token=${tokenAddress}`)
        }
      } catch (dexErr) {
        const dexMsg = dexErr instanceof Error ? dexErr.message : 'Unknown'
        logError('DEXSCREENER ENRICHMENT', `scan_id=${scanId} token=${tokenAddress} error="${dexMsg}"`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scanner error'
      await markScanFailed(scanId, tokenAddress, message)
      logError('SCAN FAILED', `scan_id=${scanId} token=${tokenAddress} error="${message}"`)
    }
  })()

  return c.json({
    status: 'scanning',
    scan_id: scanId,
    estimated_seconds: 120,
  })
})

scanRoute.get('/scan/:scanId/status', async (c) => {
  const scanId = Number.parseInt(c.req.param('scanId'), 10)
  if (!Number.isFinite(scanId)) {
    throw new ApiError(400, 'invalid_scan_id', 'Invalid scan id')
  }

  const scan = await getScanLog(scanId)
  if (!scan) {
    throw new ApiError(404, 'scan_not_found', 'Scan not found')
  }

  return c.json({
    id: scan.id,
    token_address: scan.token_address,
    chain: scan.chain,
    status: scan.scan_status,
    events_fetched: scan.events_fetched,
    holders_found: scan.holders_found,
    rpc_calls_made: scan.rpc_calls_made,
    started_at: scan.started_at,
    completed_at: scan.completed_at,
    error_message: scan.error_message,
  })
})

export default scanRoute
