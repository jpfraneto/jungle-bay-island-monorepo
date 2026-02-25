import { Hono } from 'hono'
import { CONFIG, db, normalizeAddress, toSupportedChain } from '../config'
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
  updateScanProgress,
  updateBungalowMetadata,
  upsertClaimedBungalow,
  writeScanResult,
} from '../db/queries'
import { fetchDexScreenerData } from '../services/dexscreener'
import { requireWalletAuth, optionalWalletContext } from '../middleware/auth'
import { createRateLimit } from '../middleware/rateLimit'
import { ApiError } from '../services/errors'
import {
  verifyPayment,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  SOLANA_TREASURY_ADDRESS,
  SOLANA_USDC_MINT,
  SCAN_COST_USDC,
  SCAN_COST_RAW,
} from '../services/payment'
import { logError, logEvent, logInfo, logSuccess } from '../services/logger'
import { addScanLog, getScanLogs, scheduleLogCleanup } from '../services/scanLogs'
import { scanToken } from '../services/scanner'
import { scanSolanaToken } from '../services/solanaScanner'
import type { AppEnv } from '../types'

const scanRoute = new Hono<AppEnv>()

const scanBurstLimit = createRateLimit({
  limit: 20,
  windowMs: 60 * 1000,
  keyGenerator: (c) => c.get('walletAddress') ?? 'anon',
})

scanRoute.post('/scan/:chain/:ca', optionalWalletContext, scanBurstLimit, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  const tokenAddress = chain ? normalizeAddress(c.req.param('ca'), chain) : null
  // Accept wallet from auth context OR from X-Wallet-Address header (for paid scans)
  const walletHeader = c.req.header('X-Wallet-Address')
  const requester = c.get('walletAddress') ?? (walletHeader ? normalizeAddress(walletHeader, walletHeader.startsWith('0x') ? undefined : 'solana') : null)

  logInfo('SCAN REQUEST DEBUG', `chain=${chain} ca_raw=${c.req.param('ca')} tokenAddress=${tokenAddress} walletHeader=${walletHeader} requester=${requester}`)

  if (!chain || !tokenAddress || !requester) {
    logError('SCAN VALIDATION', `failed: chain=${chain} tokenAddress=${tokenAddress} requester=${requester}`)
    throw new ApiError(400, 'invalid_params', 'Invalid scan parameters')
  }
  logInfo('SCAN REQUEST', `wallet=${requester} chain=${chain} token=${tokenAddress}`)

  const registry = await getTokenRegistry(tokenAddress, chain)
  if (registry?.scan_status === 'complete') {
    return c.json({
      status: 'already_exists',
    })
  }

  let isFreeRetry = false

  if (registry?.scan_status === 'scanning') {
    const latest = await getLatestScanByToken(tokenAddress)
    if (latest) {
      logInfo('SCAN RESTART', `scan_id=${latest.id} token=${tokenAddress} — marking old scan as failed, starting fresh`)
      await markScanFailed(latest.id, tokenAddress, 'Replaced by new scan request')
    }
    isFreeRetry = true
  }

  // Check if this is a free retry (previous scan failed, requester already paid/owns)
  if (registry?.scan_status === 'failed') {
    // Check if requester is the bungalow owner (i.e. they already paid)
    const bungalow = await db<{ current_owner: string }[]>`
      SELECT current_owner FROM ${db(CONFIG.SCHEMA)}.bungalows
      WHERE token_address = ${tokenAddress} AND is_claimed = true
      LIMIT 1
    `
    if (bungalow.length > 0 && bungalow[0].current_owner?.toLowerCase() === requester.toLowerCase()) {
      isFreeRetry = true
      logInfo('SCAN RETRY', `free retry for wallet=${requester} token=${tokenAddress} (previous scan failed, owner match)`)
    }

    // Also allow free retry if the same payment proof was already used for this token
    if (!isFreeRetry) {
      const paymentProof = c.req.header('X-Payment-Proof')
      if (paymentProof) {
        const existingTx = await db<{ tx_hash: string }[]>`
          SELECT tx_hash FROM ${db(CONFIG.SCHEMA)}.used_tx_hashes
          WHERE tx_hash = ${paymentProof} AND mint_address = ${tokenAddress}
          LIMIT 1
        `
        if (existingTx.length > 0) {
          isFreeRetry = true
          logInfo('SCAN RETRY', `free retry for wallet=${requester} token=${tokenAddress} (same payment proof, previous scan failed)`)
        }
      }
    }
  }

  const profile = await getViewerProfile(requester)
  const islandHeat = profile?.islandHeat ?? 0
  const isResidentPlus = islandHeat >= 80

  const today = new Date().toISOString().slice(0, 10)
  if (isFreeRetry) {
    // Skip payment — already paid on previous attempt
  } else if (isResidentPlus) {
    const scansUsed = await getDailyAllowanceUsed(requester, today)
    logInfo('SCAN GATE', `wallet=${requester} tier=${profile?.tier ?? 'Drifter'} scans_used_today=${scansUsed}`)
    if (scansUsed >= CONFIG.RESIDENT_DAILY_SCANS) {
      throw new ApiError(429, 'daily_limit_reached', 'Daily free scan allowance reached')
    }
  } else {
    const paymentProof = c.req.header('X-Payment-Proof')
    if (!paymentProof) {
      throw new ApiError(402, 'payment_required', 'x402 payment is required for non-residents', {
        cost_usdc: SCAN_COST_USDC,
        payment_options: [
          {
            chain: 'base',
            chain_id: 8453,
            treasury: TREASURY_ADDRESS,
            usdc_contract: USDC_ADDRESS,
          },
          {
            chain: 'solana',
            treasury: SOLANA_TREASURY_ADDRESS,
            usdc_mint: SOLANA_USDC_MINT,
          },
        ],
      })
    }

    const payment = await verifyPayment(paymentProof, tokenAddress, SCAN_COST_RAW)
    if (!payment.valid) {
      throw new ApiError(402, 'payment_failed', payment.error ?? 'Payment verification failed')
    }
    logInfo('SCAN PAYMENT', `verified ${payment.chain} tx=${paymentProof.slice(0, 10)}... from=${payment.from} for=${tokenAddress}`)
  }

  const isPaid = !isResidentPlus && !isFreeRetry
  await setTokenStatus(tokenAddress, chain, 'scanning')

  const scanId = await createScanLog({
    tokenAddress,
    chain,
    requestedBy: requester,
    requesterFid: profile?.fid ?? null,
    requesterTier: profile?.tier ?? null,
    paymentMethod: isPaid ? 'x402_usdc' : 'free_resident',
    paymentAmount: isPaid ? SCAN_COST_USDC : 0,
  })

  if (!isPaid) await incrementDailyAllowance(requester, today)

  // Auto-claim bungalow for paid scans (merges scan + claim into one $1 payment)
  if (isPaid) {
    await upsertClaimedBungalow({ tokenAddress, chain, owner: requester })
    logInfo('AUTO-CLAIM', `wallet=${requester} claimed bungalow for ${tokenAddress} via paid scan`)
  }

  logEvent('SCAN STARTED', `scan_id=${scanId} wallet=${requester} token=${tokenAddress}`)

  const SCAN_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes max

  void (async () => {
    try {
      const progressCb = (progress: { phase: string; pct: number; detail?: string }) => {
        void updateScanProgress(scanId, progress).catch(() => undefined)
        logInfo('SCAN PROGRESS', `scan_id=${scanId} token=${tokenAddress} phase=${progress.phase} pct=${progress.pct}${progress.detail ? ` detail="${progress.detail}"` : ''}`)
      }

      const logCb = (msg: string) => addScanLog(scanId, msg)

      const scanPromise = chain === 'solana'
        ? scanSolanaToken(tokenAddress, progressCb, logCb)
        : scanToken(chain, tokenAddress, progressCb, logCb)

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Scan timed out after 15 minutes')), SCAN_TIMEOUT_MS),
      )

      const result = await Promise.race([scanPromise, timeoutPromise])

      await writeScanResult(scanId, result, progressCb)
      scheduleLogCleanup(scanId)
      logSuccess(
        'SCAN COMPLETE',
        `scan_id=${scanId} token=${tokenAddress} holders=${result.holderCount} events=${result.eventsFetched} rpc_calls=${result.rpcCallsMade}`,
      )

      // Enrich bungalow with DexScreener metadata (skip for Solana — not supported)
      if (chain !== 'solana') {
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scanner error'
      await markScanFailed(scanId, tokenAddress, message)
      scheduleLogCleanup(scanId)
      logError('SCAN FAILED', `scan_id=${scanId} token=${tokenAddress} error="${message}"`)
    }
  })()

  return c.json({
    status: 'scanning',
    scan_id: scanId,
    estimated_seconds: 120,
    claimed: isPaid,
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

  const statusResponse = {
    id: scan.id,
    scan_id: scan.id,
    token_address: scan.token_address,
    chain: scan.chain,
    status: scan.scan_status,
    progress_phase: scan.progress_phase ?? null,
    progress_pct: scan.progress_pct === null ? null : Number(scan.progress_pct),
    progress_detail: scan.progress_detail ?? null,
    events_fetched: scan.events_fetched,
    holders_found: scan.holders_found,
    rpc_calls_made: scan.rpc_calls_made,
    started_at: scan.started_at,
    completed_at: scan.completed_at,
    error_message: scan.error_message,
    logs: getScanLogs(scanId),
  }

  logInfo('SCAN STATUS', `scan_id=${scan.id} status=${scan.scan_status} phase=${scan.progress_phase ?? 'null'} pct=${scan.progress_pct ?? 'null'}`)

  return c.json(statusResponse)
})

export default scanRoute
