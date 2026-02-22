import { CONFIG } from '../config'
import { calculateHeatDegrees } from './heat'
import { fetchSolanaTokenMetadata } from './solanaMetadata'
import { logInfo, logError } from './logger'
import type { ScanResult } from './scanner'

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
const HELIUS_PAGE_LIMIT = 1000
const MIN_HEAT_DEGREES = 0.01
const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (attempt >= MAX_RETRIES) throw error
    const backoff = 200 * (2 ** (attempt - 1))
    await sleep(backoff)
    return withRetry(fn, attempt + 1)
  }
}

interface MintInfo {
  decimals: number
  supply: bigint
}

async function getMintInfo(mintAddress: string): Promise<MintInfo> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [mintAddress, { encoding: 'jsonParsed' }],
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const data = await res.json() as any
  const info = data?.result?.value?.data?.parsed?.info
  if (!info) {
    throw new Error(`Failed to fetch mint info for ${mintAddress}`)
  }

  return {
    decimals: info.decimals ?? 0,
    supply: BigInt(info.supply ?? '0'),
  }
}

interface HeliusTokenAccount {
  owner: string
  amount: number
}

async function fetchAllTokenAccounts(
  mintAddress: string,
  onProgress?: (pct: number) => void,
): Promise<HeliusTokenAccount[]> {
  const apiKey = CONFIG.HELIUS_API_KEY
  if (!apiKey) {
    throw new Error('HELIUS_API_KEY is not configured')
  }

  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
  const accounts: HeliusTokenAccount[] = []
  let cursor: string | null = null
  let pageCount = 0

  while (true) {
    const body: any = {
      jsonrpc: '2.0',
      id: '1',
      method: 'getTokenAccounts',
      params: {
        mint: mintAddress,
        limit: HELIUS_PAGE_LIMIT,
      },
    }
    if (cursor) {
      body.params.cursor = cursor
    }

    const res = await withRetry(async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (!r.ok) {
        throw new Error(`Helius API error: ${r.status} ${r.statusText}`)
      }
      return r.json() as Promise<any>
    })

    const result = res?.result
    if (!result) {
      throw new Error('Invalid Helius response: missing result')
    }

    const tokenAccounts: any[] = result.token_accounts ?? []
    for (const account of tokenAccounts) {
      if (account.owner && account.amount) {
        accounts.push({
          owner: account.owner,
          amount: Number(account.amount),
        })
      }
    }

    pageCount++
    if (pageCount % 5 === 0) {
      logInfo('SOLANA SCAN', `Fetched ${pageCount} pages, ${accounts.length} accounts so far`)
    }

    // Progress: scale between 20-80% based on pages fetched
    // We don't know total pages, so use logarithmic estimate
    const estimatedPct = Math.min(80, 20 + Math.floor(60 * (1 - 1 / (1 + pageCount * 0.2))))
    onProgress?.(estimatedPct)

    cursor = result.cursor ?? null
    if (!cursor || tokenAccounts.length < HELIUS_PAGE_LIMIT) {
      break
    }
  }

  logInfo('SOLANA SCAN', `Fetched ${pageCount} pages total, ${accounts.length} token accounts`)
  return accounts
}

export async function scanSolanaToken(
  tokenAddress: string,
  onProgress?: (progress: { phase: string; pct: number }) => void,
): Promise<ScanResult> {
  const rpcCallsMade = { count: 0 }

  // Phase 1: Metadata (10%)
  onProgress?.({ phase: 'metadata', pct: 5 })
  rpcCallsMade.count++
  const mintInfo = await getMintInfo(tokenAddress)

  rpcCallsMade.count++
  const meta = await fetchSolanaTokenMetadata(tokenAddress)
  const name = meta?.name ?? 'Unknown'
  const symbol = meta?.symbol ?? 'UNKNOWN'
  const decimals = mintInfo.decimals
  const totalSupplyRaw = mintInfo.supply
  const totalSupply = Number(totalSupplyRaw) / (10 ** decimals)

  onProgress?.({ phase: 'metadata', pct: 10 })
  logInfo('SOLANA SCAN', `Token: ${name} (${symbol}), decimals=${decimals}, supply=${totalSupply}`)

  // Phase 2: Fetch all holder accounts (20-80%)
  onProgress?.({ phase: 'holders', pct: 20 })
  const accounts = await fetchAllTokenAccounts(tokenAddress, (pct) => {
    rpcCallsMade.count++
    onProgress?.({ phase: 'holders', pct })
  })

  // Phase 3: Calculate heat (90%)
  onProgress?.({ phase: 'heat', pct: 85 })
  const nowTimestamp = Math.floor(Date.now() / 1000)
  const holders: ScanResult['holders'] = []

  for (const account of accounts) {
    const balanceNormalized = account.amount / (10 ** decimals)
    const heatDegrees = calculateHeatDegrees(balanceNormalized, totalSupply)

    if (heatDegrees < MIN_HEAT_DEGREES) continue

    holders.push({
      wallet: account.owner,
      heatDegrees: Math.round(heatDegrees * 100) / 100,
      balanceRaw: account.amount.toString(),
      firstSeenAt: nowTimestamp,
      lastTransferAt: nowTimestamp,
    })
  }

  holders.sort((a, b) => b.heatDegrees - a.heatDegrees)

  onProgress?.({ phase: 'heat', pct: 90 })
  logInfo('SOLANA SCAN', `Computed heat for ${holders.length} holders (filtered from ${accounts.length} accounts)`)

  // Phase 4: Complete (100%)
  onProgress?.({ phase: 'complete', pct: 100 })
  return {
    tokenAddress,
    chain: 'solana',
    name,
    symbol,
    decimals,
    totalSupply,
    deployBlock: 0,
    deployTimestamp: nowTimestamp,
    holderCount: holders.length,
    eventsFetched: 0,
    rpcCallsMade: rpcCallsMade.count,
    holders,
  }
}
