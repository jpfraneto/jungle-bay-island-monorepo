import { Hono } from 'hono'
import { type Address } from 'viem'
import { normalizeAddress, publicClients, toSupportedChain } from '../config'
import {
  upsertClaimedBungalow,
  updateBungalowMetadata,
} from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { isBaylaConfigured, signClaimBungalow } from '../services/bayla'
import { fetchDexScreenerData } from '../services/dexscreener'
import { ApiError } from '../services/errors'
import { calculateUserHeat } from '../services/holdings'
import { logError, logInfo, logSuccess } from '../services/logger'
import { extractXUsername, lookupByXUsername } from '../services/neynar'
import type { AppEnv } from '../types'

const MINIMUM_HEAT_TO_CLAIM = 10

const TREASURY: Address = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E'
const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const claimRoute = new Hono<AppEnv>()

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

  if (!txHash) {
    throw new ApiError(400, 'missing_tx_hash', 'tx_hash is required')
  }

  logInfo('CLAIM', `wallet=${wallet} chain=${chain} token=${tokenAddress} tx=${txHash}`)

  // Verify the USDC transfer on-chain (Base only)
  if (chain === 'base') {
    try {
      const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash })

      if (receipt.status !== 'success') {
        throw new ApiError(400, 'tx_failed', 'Transaction failed on-chain')
      }

      // Look for USDC Transfer event to treasury
      const transferLog = receipt.logs.find((log) => {
        if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) return false
        try {
          const decoded = publicClients.base.chain
            ? null  // We'll decode manually
            : null
          // Check topic matches Transfer(address,address,uint256)
          // topic[0] = Transfer event sig
          // topic[1] = from (padded)
          // topic[2] = to (padded)
          const toAddress = log.topics[2]
          if (!toAddress) return false
          const to = `0x${toAddress.slice(26)}`.toLowerCase()
          return to === TREASURY.toLowerCase()
        } catch {
          return false
        }
      })

      if (!transferLog) {
        throw new ApiError(400, 'no_usdc_transfer', 'No USDC transfer to treasury found in transaction')
      }

      // Decode transfer amount from data field (uint256)
      const transferAmount = BigInt(transferLog.data)
      const transferUsdc = Number(transferAmount) / 1e6
      logInfo('CLAIM VERIFIED', `wallet=${wallet} token=${tokenAddress} usdc=${transferUsdc} tx=${txHash}`)
    } catch (err) {
      if (err instanceof ApiError) throw err
      const msg = err instanceof Error ? err.message : 'Unknown'
      logError('CLAIM TX VERIFY', `wallet=${wallet} tx=${txHash} error="${msg}"`)
      throw new ApiError(400, 'tx_verification_failed', `Could not verify transaction: ${msg}`)
    }
  }

  // --- Server-side heat eligibility check ---
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const xUsername = claims ? extractXUsername(claims) : null

  const ethWallets = new Set<string>()
  ethWallets.add(wallet.toLowerCase())

  let solWallets: string[] = []
  if (xUsername) {
    const fcProfile = await lookupByXUsername(xUsername)
    if (fcProfile) {
      for (const addr of fcProfile.ethAddresses) {
        ethWallets.add(addr.toLowerCase())
      }
      solWallets = fcProfile.solAddresses
    }
  }

  const { heat } = await calculateUserHeat(
    tokenAddress,
    chain,
    [...ethWallets],
    solWallets,
  )

  if (heat < MINIMUM_HEAT_TO_CLAIM) {
    logInfo('CLAIM REJECTED', `wallet=${wallet} token=${tokenAddress} heat=${heat} minimum=${MINIMUM_HEAT_TO_CLAIM}`)
    throw new ApiError(403, 'insufficient_heat', `You need at least ${MINIMUM_HEAT_TO_CLAIM} heat degrees to claim. Current heat: ${heat}`)
  }

  logInfo('CLAIM HEAT OK', `wallet=${wallet} token=${tokenAddress} heat=${heat}`)

  // Fetch token data from DexScreener for name/symbol
  const dexData = await fetchDexScreenerData(tokenAddress, chain)

  await upsertClaimedBungalow({
    tokenAddress,
    chain,
    owner: wallet,
    name: dexData?.tokenName ?? undefined,
    symbol: dexData?.tokenSymbol ?? undefined,
  })

  // Enrich with market data in background
  if (dexData) {
    void (async () => {
      try {
        await updateBungalowMetadata(tokenAddress, dexData)
        logSuccess('CLAIM ENRICHMENT', `token=${tokenAddress} chain=${chain}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        logError('CLAIM ENRICHMENT', `token=${tokenAddress} error="${msg}"`)
      }
    })()
  }

  // Generate Bayla signature for V7 on-chain registration
  let bayla: { signature: string; deadline: string; mode: string } | null = null
  if (chain === 'base' && isBaylaConfigured()) {
    try {
      const result = await signClaimBungalow({
        claimer: wallet,
        tokenAddress,
        ipfsHash: '',
        name: (dexData?.tokenName ?? 'Bungalow').slice(0, 64),
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
