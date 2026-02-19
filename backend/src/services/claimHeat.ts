import type { SupportedChain } from '../config'
import {
  createScanLog,
  getLatestScanByToken,
  getTokenRegistry,
  getWalletTokenHeats,
  markScanFailed,
  setTokenStatus,
  updateBungalowMetadata,
  writeScanResult,
} from '../db/queries'
import { fetchDexScreenerData } from './dexscreener'
import { logError, logEvent, logInfo, logSuccess } from './logger'
import { scanToken } from './scanner'

export interface ClaimHeatScanState {
  status: 'ready' | 'scanning'
  scanId: number | null
}

export interface ClaimWalletHeatResult {
  heat: number
  breakdown: Array<{ wallet: string; heat_degrees: number }>
}

export function isClaimHeatScannableChain(chain: SupportedChain): chain is 'base' | 'ethereum' {
  return chain === 'base' || chain === 'ethereum'
}

export async function ensureClaimHeatScan(input: {
  chain: 'base' | 'ethereum'
  tokenAddress: string
  requesterWallet: string
  requesterFid?: number | null
  requesterTier?: string | null
}): Promise<ClaimHeatScanState> {
  const registry = await getTokenRegistry(input.tokenAddress, input.chain)
  if (registry?.scan_status === 'complete') {
    return { status: 'ready', scanId: null }
  }

  if (registry?.scan_status === 'scanning') {
    const latest = await getLatestScanByToken(input.tokenAddress)
    return { status: 'scanning', scanId: latest?.id ?? null }
  }

  await setTokenStatus(input.tokenAddress, input.chain, 'scanning')

  const scanId = await createScanLog({
    tokenAddress: input.tokenAddress,
    chain: input.chain,
    requestedBy: input.requesterWallet,
    requesterFid: input.requesterFid ?? null,
    requesterTier: input.requesterTier ?? null,
    paymentMethod: 'admin',
    paymentAmount: 0,
  })

  logEvent(
    'CLAIM SCAN STARTED',
    `scan_id=${scanId} wallet=${input.requesterWallet} chain=${input.chain} token=${input.tokenAddress}`,
  )

  void (async () => {
    try {
      const result = await scanToken(input.chain, input.tokenAddress, (progress) => {
        logInfo(
          'CLAIM SCAN PROGRESS',
          `scan_id=${scanId} token=${input.tokenAddress} phase=${progress.phase} pct=${progress.pct}`,
        )
      })
      await writeScanResult(scanId, result)
      logSuccess(
        'CLAIM SCAN COMPLETE',
        `scan_id=${scanId} token=${input.tokenAddress} holders=${result.holderCount} events=${result.eventsFetched}`,
      )

      try {
        const dexData = await fetchDexScreenerData(input.tokenAddress, input.chain)
        if (dexData) {
          await updateBungalowMetadata(input.tokenAddress, dexData)
          logSuccess('CLAIM SCAN ENRICH', `scan_id=${scanId} token=${input.tokenAddress}`)
        }
      } catch (dexErr) {
        const dexMsg = dexErr instanceof Error ? dexErr.message : 'Unknown'
        logError('CLAIM SCAN ENRICH', `scan_id=${scanId} token=${input.tokenAddress} error="${dexMsg}"`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scanner error'
      await markScanFailed(scanId, input.tokenAddress, message)
      logError('CLAIM SCAN FAILED', `scan_id=${scanId} token=${input.tokenAddress} error="${message}"`)
    }
  })()

  return { status: 'scanning', scanId }
}

export async function getClaimWalletHeat(
  tokenAddress: string,
  wallets: string[],
): Promise<ClaimWalletHeatResult> {
  const normalizedWallets = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))]
  const breakdown = await getWalletTokenHeats(tokenAddress, normalizedWallets)
  const heat = breakdown.reduce((sum, row) => sum + row.heat_degrees, 0)

  return {
    heat: Math.round(heat * 100) / 100,
    breakdown: breakdown.sort((a, b) => b.heat_degrees - a.heat_degrees),
  }
}
