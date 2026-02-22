import { publicClients, CONFIG, db } from '../config'
import { parseAbiItem } from 'viem'
import { logInfo, logWarn } from './logger'

const SCHEMA = `"${CONFIG.SCHEMA}"`

export const TREASURY_ADDRESS = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E' as const
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
export const BUNGALOW_COST_USDC = 1.00
export const BUNGALOW_COST_RAW = BigInt(1_000_000) // 6 decimals

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

export async function verifyUsdcPayment(txHash: string, mintAddress: string): Promise<{
  valid: boolean
  error?: string
  from?: string
}> {
  await ensureUsedTxTable()

  // Check replay
  const existing = await db<{ tx_hash: string }[]>`
    SELECT tx_hash FROM ${db(CONFIG.SCHEMA)}.used_tx_hashes
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `
  if (existing.length > 0) {
    return { valid: false, error: 'Transaction hash already used' }
  }

  try {
    const receipt = await publicClients.base.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    })

    if (receipt.status !== 'success') {
      return { valid: false, error: 'Transaction failed or reverted' }
    }

    // Look for USDC Transfer event to treasury
    const treasuryLower = TREASURY_ADDRESS.toLowerCase()
    const usdcLower = USDC_ADDRESS.toLowerCase()

    let paymentFound = false
    let fromAddress: string | undefined

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== usdcLower) continue
      if (!log.topics[0]) continue

      // Transfer(address,address,uint256) topic
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      if (log.topics[0] !== transferTopic) continue

      // topic[2] is the `to` address (padded)
      const toAddress = log.topics[2]
      if (!toAddress) continue
      const to = '0x' + toAddress.slice(26)
      if (to.toLowerCase() !== treasuryLower) continue

      // Decode amount from data
      const amount = BigInt(log.data)
      if (amount >= BUNGALOW_COST_RAW) {
        paymentFound = true
        if (log.topics[1]) {
          fromAddress = '0x' + log.topics[1].slice(26)
        }
        break
      }
    }

    if (!paymentFound) {
      return { valid: false, error: 'No valid USDC transfer of >= $1.00 to treasury found in transaction' }
    }

    // Mark tx as used
    await db`
      INSERT INTO ${db(CONFIG.SCHEMA)}.used_tx_hashes (tx_hash, mint_address)
      VALUES (${txHash}, ${mintAddress})
      ON CONFLICT (tx_hash) DO NOTHING
    `

    logInfo('PAYMENT', `verified tx=${txHash.slice(0, 10)}... from=${fromAddress} for=${mintAddress}`)

    return { valid: true, from: fromAddress }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logWarn('PAYMENT', `verification failed tx=${txHash.slice(0, 10)}... error=${msg}`)
    return { valid: false, error: `Failed to verify transaction: ${msg}` }
  }
}
