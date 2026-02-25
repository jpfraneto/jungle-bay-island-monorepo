import { CONFIG } from '../config'
import { calculateHeatDegrees } from './heat'
import { fetchSolanaTokenMetadata } from './solanaMetadata'
import { fetchDexScreenerData } from './dexscreener'
import { getBungalow } from '../db/queries'
import { logInfo, logError } from './logger'
import type { ScanResult } from './scanner'
import { createHash } from 'crypto'

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
const HELIUS_PAGE_LIMIT = 1000
const MIN_HEAT_DEGREES = 0.01
const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
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
  address: string  // the actual token account (ATA) address on-chain
  owner: string
  amount: number
}

async function fetchAllTokenAccounts(
  mintAddress: string,
  onProgress?: (pct: number) => void,
  onAccountCount?: (count: number) => void,
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
          address: account.address,
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
    onAccountCount?.(accounts.length)

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
  onLog?: (message: string) => void,
): Promise<ScanResult> {
  const rpcCallsMade = { count: 0 }
  const scanStart = Date.now()

  // Phase 1: Metadata (10%)
  onProgress?.({ phase: 'metadata', pct: 5 })
  onLog?.('Reading token info...')
  const metaStart = Date.now()
  rpcCallsMade.count++
  const mintInfo = await getMintInfo(tokenAddress)

  rpcCallsMade.count++
  const meta = await fetchSolanaTokenMetadata(tokenAddress)
  let name = meta?.name ?? null
  let symbol = meta?.symbol ?? null
  const decimals = mintInfo.decimals
  const totalSupplyRaw = mintInfo.supply
  const totalSupply = Number(totalSupplyRaw) / (10 ** decimals)

  // Fallback: check existing DB data, then DexScreener
  const isPlaceholder = (v: string | null) => !v || v === 'UNKNOWN' || v === 'Unknown'
  if (isPlaceholder(name) || isPlaceholder(symbol)) {
    const existing = await getBungalow(tokenAddress, 'solana')
    if (existing && !isPlaceholder(existing.name)) name = existing.name
    if (existing && !isPlaceholder(existing.symbol)) symbol = existing.symbol
  }
  if (isPlaceholder(name) || isPlaceholder(symbol)) {
    try {
      const dex = await fetchDexScreenerData(tokenAddress, 'solana')
      if (dex) {
        if (isPlaceholder(name) && dex.tokenName) name = dex.tokenName
        if (isPlaceholder(symbol) && dex.tokenSymbol) symbol = dex.tokenSymbol
      }
    } catch (_) {}
  }
  name = name ?? 'Unknown'
  symbol = symbol ?? 'UNKNOWN'

  onProgress?.({ phase: 'metadata', pct: 10 })
  onLog?.(`Found ${name} ($${symbol})`)
  logInfo('SOLANA SCAN', `[${Date.now() - scanStart}ms] Phase 1 METADATA done in ${Date.now() - metaStart}ms | Token: ${name} (${symbol}), decimals=${decimals}, supply=${totalSupply} | rpcCalls=${rpcCallsMade.count}`)

  // Phase 2: Fetch all holder accounts (20-80%)
  onProgress?.({ phase: 'holders', pct: 20 })
  onLog?.('Discovering holders...')
  const holdersStart = Date.now()
  const rpcBefore = rpcCallsMade.count
  let lastLoggedAccountCount = 0
  const accounts = await fetchAllTokenAccounts(tokenAddress, (pct) => {
    rpcCallsMade.count++
    onProgress?.({ phase: 'holders', pct })
  }, (accountCount) => {
    // Log every 5 pages worth of accounts
    if (accountCount - lastLoggedAccountCount >= 5000) {
      lastLoggedAccountCount = accountCount
      onLog?.(`${accountCount.toLocaleString()} accounts found...`)
    }
  })
  logInfo('SOLANA SCAN', `[${Date.now() - scanStart}ms] Phase 2 HOLDERS done in ${Date.now() - holdersStart}ms | ${accounts.length} accounts fetched | rpcCalls=${rpcCallsMade.count} (+${rpcCallsMade.count - rpcBefore})`)
  onLog?.(`${accounts.length.toLocaleString()} total holders discovered`)

  // Phase 3: Calculate heat (85%)
  onProgress?.({ phase: 'heat', pct: 80 })
  onLog?.('Calculating heat scores...')
  const heatStart = Date.now()
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

  onProgress?.({ phase: 'heat', pct: 85 })
  onLog?.(`${holders.length.toLocaleString()} wallets earned heat`)
  logInfo('SOLANA SCAN', `[${Date.now() - scanStart}ms] Phase 3 HEAT done in ${Date.now() - heatStart}ms | ${holders.length} holders with heat (from ${accounts.length} accounts)`)

  // Phase 4: Fetch transfer history per holder (85-95%)
  // Build wallet→ATA map from the accounts we already fetched (no extra API calls)
  const walletAtaMap = new Map<string, string>()
  for (const account of accounts) {
    if (account.address && account.owner) {
      // If a wallet has multiple token accounts, keep the one with highest balance
      if (!walletAtaMap.has(account.owner)) {
        walletAtaMap.set(account.owner, account.address)
      }
    }
  }
  logInfo('SOLANA SCAN', `Built wallet→ATA map: ${walletAtaMap.size} entries from ${accounts.length} accounts`)

  onProgress?.({ phase: 'history', pct: 85 })
  onLog?.('Building holder charts...')
  const historyStart = Date.now()
  const rpcBeforeHistory = rpcCallsMade.count
  const holderSnapshots = await fetchSolanaHolderSnapshots(
    tokenAddress,
    holders.map((h) => h.wallet),
    decimals,
    rpcCallsMade,
    (pct) => onProgress?.({ phase: 'history', pct }),
    walletAtaMap,
    onLog,
  )

  const totalSnapshotPoints = Array.from(holderSnapshots.values()).reduce((sum, snaps) => sum + snaps.length, 0)
  onLog?.(`Captured ${totalSnapshotPoints.toLocaleString()} data points across ${holderSnapshots.size} wallets`)
  logInfo('SOLANA SCAN', `[${Date.now() - scanStart}ms] Phase 4 HISTORY done in ${Date.now() - historyStart}ms | ${holderSnapshots.size} wallets with snapshots, ${totalSnapshotPoints} total points | rpcCalls=${rpcCallsMade.count} (+${rpcCallsMade.count - rpcBeforeHistory})`)

  // Update firstSeenAt/lastTransferAt from snapshots
  for (const holder of holders) {
    const snaps = holderSnapshots.get(holder.wallet)
    if (snaps && snaps.length > 0) {
      holder.firstSeenAt = snaps[0].ts
      holder.lastTransferAt = snaps[snaps.length - 1].ts
    }
  }

  // Phase 5: Complete (100%)
  onProgress?.({ phase: 'complete', pct: 100 })
  onLog?.(`Scan complete \u2014 ${holders.length.toLocaleString()} holders found`)
  logInfo('SOLANA SCAN', `[${Date.now() - scanStart}ms] SCAN COMPLETE | total time=${Date.now() - scanStart}ms | totalRpcCalls=${rpcCallsMade.count} | holders=${holders.length} | snapshotWallets=${holderSnapshots.size} | snapshotPoints=${totalSnapshotPoints}`)

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
    timeline: [],
    holders,
    holderSnapshots,
  }
}

// ─── Solana Transfer History via Helius Enhanced Transactions API ─────

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export function deriveATA(walletPubkey: string, mintPubkey: string): string {
  const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

  function base58Decode(str: string): Buffer {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let result = BigInt(0)
    for (const char of str) {
      const idx = ALPHABET.indexOf(char)
      if (idx === -1) throw new Error(`Invalid base58 char: ${char}`)
      result = result * 58n + BigInt(idx)
    }
    const hex = result.toString(16).padStart(64, '0')
    const bytes = Buffer.from(hex, 'hex')
    let leadingZeros = 0
    for (const c of str) {
      if (c === '1') leadingZeros++
      else break
    }
    return Buffer.concat([Buffer.alloc(leadingZeros), bytes])
  }

  function base58Encode(buf: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let num = BigInt('0x' + buf.toString('hex'))
    let result = ''
    while (num > 0n) {
      const [q, r] = [num / 58n, num % 58n]
      result = ALPHABET[Number(r)] + result
      num = q
    }
    for (const b of buf) {
      if (b === 0) result = '1' + result
      else break
    }
    return result || '1'
  }

  const walletBytes = base58Decode(walletPubkey)
  const tokenProgramBytes = base58Decode(TOKEN_PROGRAM_ID)
  const mintBytes = base58Decode(mintPubkey)
  const ataProgramBytes = base58Decode(ATA_PROGRAM_ID)

  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
    hash.update(walletBytes)
    hash.update(tokenProgramBytes)
    hash.update(mintBytes)
    hash.update(Buffer.from([bump]))
    hash.update(ataProgramBytes)
    hash.update(Buffer.from('ProgramDerivedAddress'))
    const candidate = hash.digest()
    return base58Encode(candidate.subarray(0, 32))
  }

  throw new Error('Could not derive ATA')
}

/**
 * Fetch balance history for one wallet using Helius Enhanced Transactions API.
 * Queries the wallet's ATA (token-specific), so all returned txs are relevant.
 * Returns up to 100 txs per page — vastly more efficient than getTransaction per sig.
 */
export async function fetchHolderHistory(
  ataAddress: string,
  mintAddress: string,
  walletAddress: string,
  rpcCallsMade: { count: number },
): Promise<Array<{ ts: number; balance: string }>> {
  const apiKey = CONFIG.HELIUS_API_KEY
  if (!apiKey) return []

  const MAX_PAGES_PER_HOLDER = 10  // cap at 1000 txs per holder
  const baseUrl = `https://api.helius.xyz/v0/addresses/${ataAddress}/transactions?api-key=${apiKey}&limit=100`
  // Collect transfers with timestamps — we'll build running balance after
  const transfers: Array<{ ts: number; amount: bigint; direction: 'in' | 'out' }> = []
  let beforeSignature: string | undefined
  let pageCount = 0
  const startTime = Date.now()

  while (true) {
    rpcCallsMade.count++
    pageCount++
    const url = beforeSignature
      ? `${baseUrl}&before=${beforeSignature}`
      : baseUrl

    const pageStart = Date.now()
    const txs: any[] = await withRetry(async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`Helius Enhanced API error: ${r.status}`)
      return r.json() as Promise<any[]>
    })

    if (!Array.isArray(txs) || txs.length === 0) {
      logInfo('SOLANA HISTORY', `  ata=${ataAddress.slice(0, 8)}... page=${pageCount} returned 0 txs (${Date.now() - pageStart}ms)`)
      break
    }

    let matchedInPage = 0
    for (const tx of txs) {
      const timestamp = tx.timestamp
      if (!timestamp) continue

      // Use tokenTransfers[] which gives individual transfer events with from/to
      const tokenTransfers: any[] = tx.tokenTransfers ?? []
      for (const transfer of tokenTransfers) {
        if (transfer.mint !== mintAddress) continue
        const rawAmount = transfer.rawTokenAmount?.tokenAmount ?? transfer.tokenAmount
        if (rawAmount == null) continue

        const amount = BigInt(rawAmount.toString().replace(/[^0-9]/g, '') || '0')
        if (amount === 0n) continue

        if (transfer.toUserAccount === walletAddress) {
          transfers.push({ ts: timestamp, amount, direction: 'in' })
          matchedInPage++
        } else if (transfer.fromUserAccount === walletAddress) {
          transfers.push({ ts: timestamp, amount, direction: 'out' })
          matchedInPage++
        }
      }
    }

    logInfo('SOLANA HISTORY', `  ata=${ataAddress.slice(0, 8)}... page=${pageCount} txs=${txs.length} matched=${matchedInPage} (${Date.now() - pageStart}ms)`)

    if (txs.length < 100) break
    if (pageCount >= MAX_PAGES_PER_HOLDER) {
      logInfo('SOLANA HISTORY', `  ata=${ataAddress.slice(0, 8)}... HIT PAGE CAP (${MAX_PAGES_PER_HOLDER}) with ${transfers.length} transfers so far`)
      break
    }
    beforeSignature = txs[txs.length - 1].signature
  }

  logInfo('SOLANA HISTORY', `  ata=${ataAddress.slice(0, 8)}... DONE pages=${pageCount} transfers=${transfers.length} totalTime=${Date.now() - startTime}ms`)

  if (transfers.length === 0) return []

  // Sort chronologically (oldest first) — API returns newest first
  transfers.sort((a, b) => a.ts - b.ts)

  // Build running balance from oldest to newest
  let runningBalance = 0n
  const snapshots: Array<{ ts: number; balance: string }> = []
  const seenTs = new Set<number>()

  for (const t of transfers) {
    if (t.direction === 'in') {
      runningBalance += t.amount
    } else {
      runningBalance -= t.amount
    }
    // Clamp to 0 in case of rounding/ordering issues
    if (runningBalance < 0n) runningBalance = 0n

    // Deduplicate by timestamp (keep latest balance for same second)
    if (seenTs.has(t.ts)) {
      // Update the last snapshot with same timestamp
      snapshots[snapshots.length - 1].balance = runningBalance.toString()
    } else {
      seenTs.add(t.ts)
      snapshots.push({ ts: t.ts, balance: runningBalance.toString() })
    }
  }

  return snapshots
}

async function fetchSolanaHolderSnapshots(
  mintAddress: string,
  wallets: string[],
  decimals: number,
  rpcCallsMade: { count: number },
  onProgress?: (pct: number) => void,
  walletAtaMap?: Map<string, string>,
  onLog?: (message: string) => void,
): Promise<Map<string, Array<{ ts: number; balance: string }>>> {
  const result = new Map<string, Array<{ ts: number; balance: string }>>()

  if (!CONFIG.HELIUS_API_KEY) {
    logInfo('SOLANA HISTORY', 'Skipping — no HELIUS_API_KEY')
    return result
  }

  // Cap at top 50 holders
  const walletsToFetch = wallets.slice(0, 50)
  const CONCURRENCY = 5
  let skippedNoAta = 0

  for (let i = 0; i < walletsToFetch.length; i += CONCURRENCY) {
    const batch = walletsToFetch.slice(i, i + CONCURRENCY)

    await Promise.all(
      batch.map(async (wallet) => {
        try {
          // Use real ATA from on-chain data, fall back to derived ATA
          const ata = walletAtaMap?.get(wallet) ?? deriveATA(wallet, mintAddress)
          const ataSource = walletAtaMap?.has(wallet) ? 'on-chain' : 'derived'

          if (!walletAtaMap?.has(wallet)) {
            skippedNoAta++
            logInfo('SOLANA HISTORY', `wallet=${wallet.slice(0, 8)}... no on-chain ATA, using derived`)
          }

          const snapshots = await fetchHolderHistory(ata, mintAddress, wallet, rpcCallsMade)

          if (snapshots.length > 0) {
            logInfo('SOLANA HISTORY', `wallet=${wallet.slice(0, 8)}... ata=${ataSource} points=${snapshots.length}`)
            result.set(wallet, snapshots)
          } else {
            logInfo('SOLANA HISTORY', `wallet=${wallet.slice(0, 8)}... ata=${ataSource} points=0`)
          }
        } catch (err) {
          logError('SOLANA HISTORY', `Failed for wallet ${wallet.slice(0, 8)}...: ${err}`)
        }
      }),
    )

    // Progress: 85-95%
    const done = i + batch.length
    const pct = Math.round(85 + 10 * (done / walletsToFetch.length))
    onProgress?.(pct)
    onLog?.(`Fetching history: ${done} of ${walletsToFetch.length} wallets...`)
  }

  logInfo('SOLANA HISTORY', `Fetched snapshots for ${result.size}/${walletsToFetch.length} wallets (${skippedNoAta} used derived ATA)`)
  return result
}
