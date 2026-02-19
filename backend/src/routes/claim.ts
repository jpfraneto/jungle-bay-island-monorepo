import { Hono } from 'hono'
import { type Address } from 'viem'
import { normalizeAddress, publicClients, toSupportedChain } from '../config'
import {
  upsertClaimedBungalow,
  updateBungalowMetadata,
} from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { isBaylaConfigured, signClaimBungalow } from '../services/bayla'
import { ensureClaimHeatScan, getClaimWalletHeat, isClaimHeatScannableChain } from '../services/claimHeat'
import { fetchDexScreenerData } from '../services/dexscreener'
import { ApiError } from '../services/errors'
import { logError, logInfo, logSuccess } from '../services/logger'
import { extractXUsername, lookupByXUsername } from '../services/neynar'
import type { AppEnv } from '../types'

const MINIMUM_HEAT_TO_CLAIM = 10
const TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const TREASURY: Address = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E'
const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const claimRoute = new Hono<AppEnv>()

function toTopicAddress(topic: string | null | undefined): string | null {
  if (!topic || topic.length < 66) return null
  return `0x${topic.slice(-40)}`.toLowerCase()
}

function computeClaimPriceUsdc(marketCap: number): number {
  const rawPrice = marketCap * 0.001
  return Math.min(Math.max(rawPrice, 1), 1000)
}

claimRoute.post('/bungalow/claim', requireWalletAuth, async (c) => {
  const wallet = c.get('walletAddress')
  if (!wallet) {
    throw new ApiError(401, 'auth_required', 'Wallet authentication required')
  }

  const body = await c.req.json<{
    chain?: unknown
    ca?: unknown
    tx_hash?: unknown
  }>()

  const chain = typeof body.chain === 'string' ? toSupportedChain(body.chain) : null
  const tokenAddress = chain && typeof body.ca === 'string'
    ? normalizeAddress(body.ca, chain)
    : null
  const txHash = typeof body.tx_hash === 'string'
    ? body.tx_hash.trim() as `0x${string}`
    : null

  if (!chain || !tokenAddress) {
    throw new ApiError(400, 'invalid_payload', 'chain and ca are required')
  }
  if (chain !== 'base') {
    throw new ApiError(400, 'unsupported_chain', 'Claiming is currently supported on Base only')
  }
  if (!txHash) {
    throw new ApiError(400, 'missing_tx_hash', 'tx_hash is required')
  }

  logInfo('CLAIM', `wallet=${wallet} chain=${chain} token=${tokenAddress} tx=${txHash}`)

  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const xUsername = claims ? extractXUsername(claims) : null

  const ethWallets = new Set<string>()
  ethWallets.add(wallet.toLowerCase())

  let requesterFid: number | null = null
  if (xUsername) {
    const fcProfile = await lookupByXUsername(xUsername)
    if (fcProfile) {
      requesterFid = fcProfile.fid
      for (const addr of fcProfile.ethAddresses) {
        ethWallets.add(addr.toLowerCase())
      }
    }
  }

  if (!isClaimHeatScannableChain(chain)) {
    throw new ApiError(400, 'unsupported_chain', 'Claim heat scanning is currently available for Base and Ethereum tokens')
  }

  const scanState = await ensureClaimHeatScan({
    chain,
    tokenAddress,
    requesterWallet: wallet,
    requesterFid,
    requesterTier: null,
  })

  if (scanState.status === 'scanning') {
    throw new ApiError(
      409,
      'heat_scan_in_progress',
      'Heat scan for this token is in progress. Wait for completion before claiming.',
      { scan_id: scanState.scanId },
    )
  }

  const { heat } = await getClaimWalletHeat(tokenAddress, [...ethWallets])
  if (heat < MINIMUM_HEAT_TO_CLAIM) {
    logInfo('CLAIM REJECTED', `wallet=${wallet} token=${tokenAddress} heat=${heat} minimum=${MINIMUM_HEAT_TO_CLAIM}`)
    throw new ApiError(403, 'insufficient_heat', `You need at least ${MINIMUM_HEAT_TO_CLAIM} heat degrees to claim. Current heat: ${heat}`)
  }
  logInfo('CLAIM HEAT OK', `wallet=${wallet} token=${tokenAddress} heat=${heat}`)

  const dexData = await fetchDexScreenerData(tokenAddress, chain)
  if (!dexData) {
    throw new ApiError(404, 'token_not_found', 'Could not find token data on DexScreener')
  }

  const claimPriceUsdc = computeClaimPriceUsdc(dexData.marketCap ?? 0)
  const minPaymentUnits = BigInt(Math.round(claimPriceUsdc * 1_000_000))

  try {
    const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      throw new ApiError(400, 'tx_failed', 'Transaction failed on-chain')
    }

    const matchingTransfers = receipt.logs
      .filter((log) => log.address.toLowerCase() === USDC_BASE.toLowerCase())
      .map((log) => {
        const signature = log.topics[0]?.toLowerCase() ?? ''
        if (signature !== TRANSFER_EVENT_SIG) return null
        const from = toTopicAddress(log.topics[1] ?? null)
        const to = toTopicAddress(log.topics[2] ?? null)
        if (!from || !to) return null
        if (to !== TREASURY.toLowerCase()) return null
        const amount = BigInt(log.data)
        return { from, amount }
      })
      .filter((row): row is { from: string; amount: bigint } => row !== null)
      .filter((row) => ethWallets.has(row.from))

    if (matchingTransfers.length === 0) {
      throw new ApiError(
        400,
        'invalid_payer_wallet',
        'No USDC transfer from a connected wallet to treasury was found in this transaction',
      )
    }

    const paidUnits = matchingTransfers.reduce((sum, row) => sum + row.amount, 0n)
    if (paidUnits < minPaymentUnits) {
      const paidUsdc = Number(paidUnits) / 1e6
      throw new ApiError(
        400,
        'insufficient_payment',
        `USDC transfer is below claim price. Required: $${claimPriceUsdc.toFixed(2)}, paid: $${paidUsdc.toFixed(2)}`,
      )
    }

    const paidUsdc = Number(paidUnits) / 1e6
    logInfo('CLAIM VERIFIED', `wallet=${wallet} token=${tokenAddress} usdc=${paidUsdc} tx=${txHash}`)
  } catch (err) {
    if (err instanceof ApiError) throw err
    const msg = err instanceof Error ? err.message : 'Unknown'
    logError('CLAIM TX VERIFY', `wallet=${wallet} tx=${txHash} error="${msg}"`)
    throw new ApiError(400, 'tx_verification_failed', `Could not verify transaction: ${msg}`)
  }

  await upsertClaimedBungalow({
    tokenAddress,
    chain,
    owner: wallet,
    name: dexData.tokenName ?? undefined,
    symbol: dexData.tokenSymbol ?? undefined,
  })

  void (async () => {
    try {
      await updateBungalowMetadata(tokenAddress, dexData)
      logSuccess('CLAIM ENRICHMENT', `token=${tokenAddress} chain=${chain}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      logError('CLAIM ENRICHMENT', `token=${tokenAddress} error="${msg}"`)
    }
  })()

  let bayla: { signature: string; deadline: string; mode: string } | null = null
  if (chain === 'base' && isBaylaConfigured()) {
    try {
      const result = await signClaimBungalow({
        claimer: wallet,
        tokenAddress,
        ipfsHash: '',
        name: (dexData.tokenName ?? 'Bungalow').slice(0, 64),
        jbmAmount: 0n,
        nativeTokenAmount: 0n,
        daimoPaymentId: txHash,
      })
      if (result) {
        bayla = {
          signature: result.signature,
          deadline: result.deadline.toString(),
          mode: 'live',
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      logError('BAYLA SIGN', `wallet=${wallet} token=${tokenAddress} error="${msg}"`)
    }
  }

  logSuccess('CLAIM SUCCESS', `wallet=${wallet} chain=${chain} token=${tokenAddress}`)

  return c.json({
    bungalow: {
      chain,
      ca: tokenAddress,
      claimed_by: wallet,
    },
    bayla,
  })
})

export default claimRoute
