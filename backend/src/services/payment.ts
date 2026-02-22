import { publicClients, CONFIG, db } from '../config'
import { parseAbiItem } from 'viem'
import { logInfo, logWarn } from './logger'
import { withRetry } from './solanaScanner'

const SCHEMA = `"${CONFIG.SCHEMA}"`

// --- EVM (Base) constants ---
export const TREASURY_ADDRESS = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E' as const
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

// --- Solana constants ---
export const SOLANA_TREASURY_ADDRESS = 'Grd283VR3E1KQnrdpHkPhAB5BwSGX7Rq5WPdBs416pes' as const
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as const

// --- Prices ---
export const BUNGALOW_COST_USDC = 1.00
export const BUNGALOW_COST_RAW = BigInt(1_000_000) // 6 decimals
export const SCAN_COST_USDC = 1.00
export const SCAN_COST_RAW = BigInt(1_000_000) // 6 decimals

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

let usedTxTablePromise: Promise<void> | null = null

async function ensureUsedTxTable(): Promise<void> {
  if (!usedTxTablePromise) {
    usedTxTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.used_tx_hashes (
          tx_hash TEXT PRIMARY KEY,
          used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          mint_address TEXT NOT NULL
        )
      `
    })()
  }
  await usedTxTablePromise
}

async function checkAndMarkTxUsed(txId: string, mintAddress: string): Promise<string | null> {
  await ensureUsedTxTable()

  const existing = await db<{ tx_hash: string }[]>`
    SELECT tx_hash FROM ${db(CONFIG.SCHEMA)}.used_tx_hashes
    WHERE tx_hash = ${txId}
    LIMIT 1
  `
  if (existing.length > 0) {
    return 'Transaction hash already used'
  }

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.used_tx_hashes (tx_hash, mint_address)
    VALUES (${txId}, ${mintAddress})
    ON CONFLICT (tx_hash) DO NOTHING
  `
  return null
}

// ============================================================
// EVM (Base) USDC verification
// ============================================================

export async function verifyEvmUsdcPayment(
  txHash: string,
  mintAddress: string,
  requiredAmountRaw: bigint = BUNGALOW_COST_RAW,
): Promise<{ valid: boolean; error?: string; from?: string }> {
  const replayError = await checkAndMarkTxUsed(txHash, mintAddress)
  if (replayError) return { valid: false, error: replayError }

  try {
    const receipt = await publicClients.base.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    })

    if (receipt.status !== 'success') {
      return { valid: false, error: 'Transaction failed or reverted' }
    }

    const treasuryLower = TREASURY_ADDRESS.toLowerCase()
    const usdcLower = USDC_ADDRESS.toLowerCase()

    let paymentFound = false
    let fromAddress: string | undefined

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== usdcLower) continue
      if (!log.topics[0]) continue

      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      if (log.topics[0] !== transferTopic) continue

      const toAddress = log.topics[2]
      if (!toAddress) continue
      const to = '0x' + toAddress.slice(26)
      if (to.toLowerCase() !== treasuryLower) continue

      const amount = BigInt(log.data)
      if (amount >= requiredAmountRaw) {
        paymentFound = true
        if (log.topics[1]) {
          fromAddress = '0x' + log.topics[1].slice(26)
        }
        break
      }
    }

    if (!paymentFound) {
      const usdcAmount = Number(requiredAmountRaw) / 1_000_000
      return { valid: false, error: `No valid USDC transfer of >= $${usdcAmount.toFixed(2)} to treasury found in transaction` }
    }

    logInfo('PAYMENT', `verified EVM tx=${txHash.slice(0, 10)}... from=${fromAddress} for=${mintAddress}`)
    return { valid: true, from: fromAddress }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logWarn('PAYMENT', `EVM verification failed tx=${txHash.slice(0, 10)}... error=${msg}`)
    return { valid: false, error: `Failed to verify transaction: ${msg}` }
  }
}

// ============================================================
// Solana USDC verification
// ============================================================

async function heliusRpc(method: string, params: any[]): Promise<any> {
  const apiKey = CONFIG.HELIUS_API_KEY
  if (!apiKey) throw new Error('HELIUS_API_KEY is not configured')

  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`

  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`Helius RPC error: ${res.status} ${res.statusText}`)
    }
    const data = await res.json() as any
    if (data.error) {
      throw new Error(`Helius RPC error: ${data.error.message ?? JSON.stringify(data.error)}`)
    }
    return data.result
  })
}

export async function verifySolanaUsdcPayment(
  txSignature: string,
  mintAddress: string,
  requiredAmountRaw: bigint = BUNGALOW_COST_RAW,
): Promise<{ valid: boolean; error?: string; from?: string }> {
  const replayError = await checkAndMarkTxUsed(txSignature, mintAddress)
  if (replayError) return { valid: false, error: replayError }

  try {
    const tx = await heliusRpc('getTransaction', [
      txSignature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ])

    if (!tx) {
      return { valid: false, error: 'Transaction not found on Solana' }
    }

    // Check tx succeeded
    if (tx.meta?.err !== null) {
      return { valid: false, error: 'Solana transaction failed' }
    }

    // Strategy: check postTokenBalances vs preTokenBalances for treasury USDC increase
    const pre: any[] = tx.meta?.preTokenBalances ?? []
    const post: any[] = tx.meta?.postTokenBalances ?? []

    // Find treasury's USDC balance change
    const treasuryPostEntry = post.find(
      (b: any) => b.owner === SOLANA_TREASURY_ADDRESS && b.mint === SOLANA_USDC_MINT,
    )

    if (!treasuryPostEntry) {
      return { valid: false, error: 'No USDC transfer to treasury found in transaction' }
    }

    const postAmount = BigInt(treasuryPostEntry.uiTokenAmount?.amount ?? '0')

    // Find matching pre-balance (may not exist if ATA was just created)
    const treasuryPreEntry = pre.find(
      (b: any) => b.owner === SOLANA_TREASURY_ADDRESS && b.mint === SOLANA_USDC_MINT,
    )
    const preAmount = treasuryPreEntry
      ? BigInt(treasuryPreEntry.uiTokenAmount?.amount ?? '0')
      : 0n

    const increase = postAmount - preAmount
    if (increase < requiredAmountRaw) {
      const usdcAmount = Number(requiredAmountRaw) / 1_000_000
      return {
        valid: false,
        error: `USDC transfer amount insufficient: got $${(Number(increase) / 1_000_000).toFixed(2)}, need >= $${usdcAmount.toFixed(2)}`,
      }
    }

    // Try to find the sender from parsed instructions
    let fromAddress: string | undefined
    const instructions = tx.transaction?.message?.instructions ?? []
    for (const ix of instructions) {
      const parsed = ix.parsed
      if (!parsed) continue
      if (ix.program !== 'spl-token') continue
      if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue
      fromAddress = parsed.info?.authority ?? parsed.info?.source
      if (fromAddress) break
    }

    // Also check inner instructions
    if (!fromAddress) {
      const innerInstructions = tx.meta?.innerInstructions ?? []
      for (const inner of innerInstructions) {
        for (const ix of inner.instructions ?? []) {
          const parsed = ix.parsed
          if (!parsed) continue
          if (ix.program !== 'spl-token') continue
          if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue
          fromAddress = parsed.info?.authority ?? parsed.info?.source
          if (fromAddress) break
        }
        if (fromAddress) break
      }
    }

    logInfo('PAYMENT', `verified Solana tx=${txSignature.slice(0, 10)}... from=${fromAddress} for=${mintAddress} amount=$${(Number(increase) / 1_000_000).toFixed(2)}`)
    return { valid: true, from: fromAddress }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logWarn('PAYMENT', `Solana verification failed tx=${txSignature.slice(0, 10)}... error=${msg}`)
    return { valid: false, error: `Failed to verify Solana transaction: ${msg}` }
  }
}

// ============================================================
// Unified payment verification — auto-routes by proof format
// ============================================================

function isSolanaSignature(proof: string): boolean {
  // Solana tx signatures are base58-encoded, typically 87-88 chars
  return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(proof) && !proof.startsWith('0x')
}

function isEvmTxHash(proof: string): boolean {
  const normalized = proof.startsWith('0x') ? proof : `0x${proof}`
  return /^0x[a-fA-F0-9]{64}$/.test(normalized)
}

export async function verifyPayment(
  proof: string,
  mintAddress: string,
  requiredAmountRaw: bigint = BUNGALOW_COST_RAW,
): Promise<{ valid: boolean; error?: string; from?: string; chain: 'base' | 'solana' }> {
  if (isSolanaSignature(proof)) {
    const result = await verifySolanaUsdcPayment(proof, mintAddress, requiredAmountRaw)
    return { ...result, chain: 'solana' }
  }

  if (isEvmTxHash(proof)) {
    const txHash = proof.startsWith('0x') ? proof : `0x${proof}`
    const result = await verifyEvmUsdcPayment(txHash, mintAddress, requiredAmountRaw)
    return { ...result, chain: 'base' }
  }

  return {
    valid: false,
    error: 'Invalid payment proof format. Expected EVM tx hash (0x + 64 hex) or Solana tx signature (base58)',
    chain: 'base',
  }
}

// Backwards-compatible alias
export const verifyUsdcPayment = verifyEvmUsdcPayment
