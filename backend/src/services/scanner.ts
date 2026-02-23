import {
  createPublicClient,
  formatUnits,
  http,
} from 'viem'
import { base, mainnet } from 'viem/chains'
import { calculateHeatDegrees, calculateTWAB, type BalanceSnapshot } from './heat'
import { logInfo } from './logger'

export interface TimelineBucket {
  t: number  // timestamp (start of bucket)
  c: number  // transfer count in this bucket
}

export interface ScanResult {
  tokenAddress: string
  chain: 'base' | 'ethereum' | 'solana'
  name: string
  symbol: string
  decimals: number
  totalSupply: number
  deployBlock: number
  deployTimestamp: number
  holderCount: number
  eventsFetched: number
  rpcCallsMade: number
  timeline: TimelineBucket[]
  holders: {
    wallet: string
    heatDegrees: number
    balanceRaw: string
    firstSeenAt: number
    lastTransferAt: number
  }[]
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_RETRIES = 3
const ALCHEMY_PAGE_SIZE = '0x3e8' // 1000 per page

const erc20ReadAbi = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const erc721ReadAbi = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

type TransferEvent = {
  from: string
  to: string
  value: bigint
  blockNumber: number
  timestamp: number
}

interface WalletLedger {
  balance: bigint
  snapshots: BalanceSnapshot[]
  firstSeenAt: number
  lastTransferAt: number
}

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

function getClient(chain: 'base' | 'ethereum') {
  if (chain === 'base') {
    return createPublicClient({ chain: base, transport: http(process.env.PONDER_RPC_URL_8453) })
  }
  return createPublicClient({ chain: mainnet, transport: http(process.env.PONDER_RPC_URL_1) })
}

function getRpcUrl(chain: 'base' | 'ethereum'): string {
  return chain === 'base'
    ? process.env.PONDER_RPC_URL_8453!
    : process.env.PONDER_RPC_URL_1!
}

async function getTokenMetadata(
  client: ReturnType<typeof getClient>,
  tokenAddress: `0x${string}`,
  rpcCounter: { count: number },
): Promise<{ name: string; symbol: string; decimals: number; totalSupply: number; isNft: boolean }> {
  const read = async <T>(fn: () => Promise<T>): Promise<T> => {
    rpcCounter.count += 1
    return withRetry(fn)
  }

  let name = ''
  let symbol = ''
  let decimals = 0
  let totalSupply = 0
  let isNft = false

  try {
    const [rawName, rawSymbol, rawDecimals, rawSupply] = await Promise.all([
      read(() => client.readContract({ address: tokenAddress, abi: erc20ReadAbi, functionName: 'name' })),
      read(() => client.readContract({ address: tokenAddress, abi: erc20ReadAbi, functionName: 'symbol' })),
      read(() => client.readContract({ address: tokenAddress, abi: erc20ReadAbi, functionName: 'decimals' })),
      read(() => client.readContract({ address: tokenAddress, abi: erc20ReadAbi, functionName: 'totalSupply' })),
    ])
    name = rawName
    symbol = rawSymbol
    decimals = Number(rawDecimals)
    totalSupply = Number(formatUnits(rawSupply, rawDecimals))
  } catch {
    isNft = true
    const [rawName, rawSymbol, rawSupply] = await Promise.all([
      read(() => client.readContract({ address: tokenAddress, abi: erc721ReadAbi, functionName: 'name' }).catch(() => 'Unknown')),
      read(() => client.readContract({ address: tokenAddress, abi: erc721ReadAbi, functionName: 'symbol' }).catch(() => 'UNKNOWN')),
      read(() => client.readContract({ address: tokenAddress, abi: erc721ReadAbi, functionName: 'totalSupply' }).catch(() => 0n)),
    ])
    name = String(rawName)
    symbol = String(rawSymbol)
    decimals = 0
    totalSupply = Number(rawSupply)
  }

  return { name, symbol, decimals, totalSupply, isNft }
}

interface AlchemyTransfer {
  blockNum: string
  from: string
  to: string
  value: number | null
  rawContract: {
    value: string | null
    address: string
    decimal: string | null
  } | null
  metadata: {
    blockTimestamp: string
  } | null
  category: string
  hash: string
}

async function fetchAllTransfers(
  rpcUrl: string,
  tokenAddress: string,
  isNft: boolean,
  rpcCounter: { count: number },
  onProgress?: (progress: { phase: string; pct: number; detail?: string }) => void,
): Promise<TransferEvent[]> {
  const category = isNft ? ['erc721'] : ['erc20']
  const events: TransferEvent[] = []
  let pageKey: string | undefined
  let page = 0

  do {
    rpcCounter.count += 1

    const params: Record<string, unknown> = {
      fromBlock: '0x0',
      toBlock: 'latest',
      contractAddresses: [tokenAddress],
      category,
      withMetadata: true,
      excludeZeroValue: !isNft,
      maxCount: ALCHEMY_PAGE_SIZE,
      order: 'asc',
    }
    if (pageKey) {
      params.pageKey = pageKey
    }

    const response = await withRetry(async () => {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'alchemy_getAssetTransfers',
          params: [params],
        }),
      })
      if (!res.ok) {
        throw new Error(`Alchemy API error: ${res.status} ${res.statusText}`)
      }
      const data = await res.json()
      if (data.error) {
        throw new Error(`Alchemy RPC error: ${data.error.message || JSON.stringify(data.error)}`)
      }
      return data.result as { transfers: AlchemyTransfer[]; pageKey?: string }
    })

    for (const t of response.transfers) {
      const blockNumber = parseInt(t.blockNum, 16)
      const timestamp = t.metadata?.blockTimestamp
        ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      let value: bigint

      if (isNft) {
        value = 1n
      } else if (t.rawContract?.value) {
        value = BigInt(t.rawContract.value)
      } else {
        // Fallback: use decimal value * 10^decimals
        const dec = t.rawContract?.decimal ? parseInt(t.rawContract.decimal, 16) : 18
        value = BigInt(Math.round((t.value ?? 0) * (10 ** dec)))
      }

      events.push({
        from: t.from.toLowerCase(),
        to: t.to.toLowerCase(),
        value,
        blockNumber,
        timestamp,
      })
    }

    pageKey = response.pageKey || undefined
    page++
    logInfo('ALCHEMY TRANSFERS', `token=${tokenAddress} page=${page} got=${response.transfers.length} total=${events.length} hasMore=${!!pageKey}`)

    // Progress: 15% to 70% across pages using asymptotic curve
    if (onProgress) {
      const pct = pageKey
        ? Math.round(15 + 55 * (1 - 1 / (1 + page / 10)))
        : 70
      const detail = `${events.length.toLocaleString()} transfers fetched`
      onProgress({ phase: 'transfers', pct, detail })
    }
  } while (pageKey)

  return events
}

function buildTransferTimeline(events: TransferEvent[], deployTimestamp: number): TimelineBucket[] {
  const now = Math.floor(Date.now() / 1000)
  const spanSeconds = now - deployTimestamp
  const DAY = 86400
  const WEEK = 7 * DAY
  const MONTH = 30 * DAY

  // Adaptive bucketing: daily (<90 days), weekly (<1 year), monthly (>1 year)
  let bucketSize: number
  if (spanSeconds < 90 * DAY) {
    bucketSize = DAY
  } else if (spanSeconds < 365 * DAY) {
    bucketSize = WEEK
  } else {
    bucketSize = MONTH
  }

  // Create buckets from deploy to now
  const buckets: TimelineBucket[] = []
  const bucketStart = deployTimestamp - (deployTimestamp % bucketSize)
  for (let t = bucketStart; t <= now; t += bucketSize) {
    buckets.push({ t, c: 0 })
  }

  // Fill buckets with event counts
  for (const event of events) {
    const idx = Math.floor((event.timestamp - bucketStart) / bucketSize)
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].c++
    }
  }

  return buckets
}

function formatDateShort(ts: number): string {
  const d = new Date(ts * 1000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function computeHolderHeat(
  walletLedgers: Map<string, WalletLedger>,
  deployTimestamp: number,
  totalSupply: number,
  decimals: number,
): ScanResult['holders'] {
  const nowTimestamp = Math.floor(Date.now() / 1000)
  const holders: ScanResult['holders'] = []

  for (const [wallet, ledger] of walletLedgers.entries()) {
    const twab = calculateTWAB(ledger.snapshots, deployTimestamp, nowTimestamp)
    const normalizedTwab = decimals > 0 ? twab / (10 ** decimals) : twab
    const heat = calculateHeatDegrees(normalizedTwab, totalSupply)

    if (heat <= 0) continue

    holders.push({
      wallet,
      heatDegrees: Math.round(heat * 100) / 100,
      balanceRaw: ledger.balance.toString(),
      firstSeenAt: ledger.firstSeenAt,
      lastTransferAt: ledger.lastTransferAt,
    })
  }

  holders.sort((a, b) => b.heatDegrees - a.heatDegrees)
  return holders
}

export async function scanToken(
  chain: 'base' | 'ethereum',
  tokenAddress: string,
  onProgress?: (progress: { phase: string; pct: number; detail?: string }) => void,
): Promise<ScanResult> {
  const client = getClient(chain)
  const rpcUrl = getRpcUrl(chain)
  const checksumAddress = tokenAddress.toLowerCase() as `0x${string}`
  const rpcCounter = { count: 0 }

  // Phase 1: metadata (5%)
  onProgress?.({ phase: 'metadata', pct: 5, detail: 'Reading token contract' })
  const metadata = await getTokenMetadata(client, checksumAddress, rpcCounter)

  // Phase 2: fetch all transfers via Alchemy API (15-70%)
  onProgress?.({ phase: 'transfers', pct: 15, detail: 'Starting transfer fetch' })
  const events = await fetchAllTransfers(rpcUrl, checksumAddress, metadata.isNft, rpcCounter, onProgress)

  if (events.length === 0) {
    throw new Error('No Transfer events found for token')
  }

  // Deploy block/timestamp from first transfer
  const deployBlock = events[0].blockNumber
  const deployTimestamp = events[0].timestamp

  // Enhanced progress: show date range
  const dateRange = `${events.length.toLocaleString()} transfers (${formatDateShort(deployTimestamp)} \u2192 ${formatDateShort(Math.floor(Date.now() / 1000))})`
  onProgress?.({ phase: 'transfers', pct: 72, detail: dateRange })

  // Build transfer timeline
  const timeline = buildTransferTimeline(events, deployTimestamp)

  // Phase 3: build wallet ledgers (75%)
  onProgress?.({ phase: 'balances', pct: 75, detail: `Processing ${events.length.toLocaleString()} transfers` })
  const ledgers = new Map<string, WalletLedger>()

  for (const event of events) {
    if (event.from !== ZERO_ADDRESS) {
      const key = event.from
      const current = ledgers.get(key) ?? {
        balance: 0n,
        snapshots: [],
        firstSeenAt: event.timestamp,
        lastTransferAt: event.timestamp,
      }

      current.balance -= event.value
      current.lastTransferAt = event.timestamp
      current.snapshots.push({ timestamp: event.timestamp, balance: current.balance })
      ledgers.set(key, current)
    }

    if (event.to !== ZERO_ADDRESS) {
      const key = event.to
      const current = ledgers.get(key) ?? {
        balance: 0n,
        snapshots: [],
        firstSeenAt: event.timestamp,
        lastTransferAt: event.timestamp,
      }

      current.balance += event.value
      current.lastTransferAt = event.timestamp
      current.snapshots.push({ timestamp: event.timestamp, balance: current.balance })
      ledgers.set(key, current)
    }
  }

  // Phase 4: compute heat (90%)
  onProgress?.({ phase: 'heat', pct: 90, detail: `Scoring ${ledgers.size.toLocaleString()} wallets` })
  const holders = computeHolderHeat(ledgers, deployTimestamp, metadata.totalSupply, metadata.decimals)

  onProgress?.({ phase: 'complete', pct: 100 })
  return {
    tokenAddress: checksumAddress,
    chain,
    name: metadata.name,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    totalSupply: metadata.totalSupply,
    deployBlock,
    deployTimestamp,
    holderCount: holders.length,
    eventsFetched: events.length,
    rpcCallsMade: rpcCounter.count,
    timeline,
    holders,
  }
}

export async function fetchHolderBalanceHistory(
  chain: 'base' | 'ethereum',
  tokenAddress: string,
  walletAddress: string,
): Promise<{ points: Array<{ t: number; b: number }>; decimals: number }> {
  const rpcUrl = getRpcUrl(chain)
  const wallet = walletAddress.toLowerCase()

  async function fetchDirection(direction: 'to' | 'from'): Promise<TransferEvent[]> {
    const events: TransferEvent[] = []
    let pageKey: string | undefined

    do {
      const params: Record<string, unknown> = {
        fromBlock: '0x0',
        toBlock: 'latest',
        contractAddresses: [tokenAddress],
        category: ['erc20'],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: ALCHEMY_PAGE_SIZE,
        order: 'asc',
      }
      if (direction === 'to') params.toAddress = walletAddress
      else params.fromAddress = walletAddress
      if (pageKey) params.pageKey = pageKey

      const response = await withRetry(async () => {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_getAssetTransfers',
            params: [params],
          }),
        })
        if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        return data.result as { transfers: AlchemyTransfer[]; pageKey?: string }
      })

      for (const t of response.transfers) {
        const timestamp = t.metadata?.blockTimestamp
          ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
          : Math.floor(Date.now() / 1000)
        let value: bigint
        if (t.rawContract?.value) {
          value = BigInt(t.rawContract.value)
        } else {
          const dec = t.rawContract?.decimal ? parseInt(t.rawContract.decimal, 16) : 18
          value = BigInt(Math.round((t.value ?? 0) * (10 ** dec)))
        }
        events.push({
          from: t.from.toLowerCase(),
          to: t.to.toLowerCase(),
          value,
          blockNumber: parseInt(t.blockNum, 16),
          timestamp,
        })
      }

      pageKey = response.pageKey || undefined
    } while (pageKey)

    return events
  }

  const [incoming, outgoing] = await Promise.all([
    fetchDirection('to'),
    fetchDirection('from'),
  ])

  const all = [...incoming, ...outgoing]
  all.sort((a, b) => a.timestamp - b.timestamp || a.blockNumber - b.blockNumber)

  // Get decimals
  const client = getClient(chain)
  let decimals = 18
  try {
    const raw = await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20ReadAbi,
      functionName: 'decimals',
    })
    decimals = Number(raw)
  } catch {}

  // Reconstruct running balance
  let balance = 0n
  const rawPoints: Array<{ t: number; b: bigint }> = []

  for (const event of all) {
    if (event.to === wallet) balance += event.value
    if (event.from === wallet) balance -= event.value
    rawPoints.push({ t: event.timestamp, b: balance })
  }

  // Add current point if we have data
  if (rawPoints.length > 0) {
    const last = rawPoints[rawPoints.length - 1]
    const now = Math.floor(Date.now() / 1000)
    if (now - last.t > 3600) {
      rawPoints.push({ t: now, b: last.b })
    }
  }

  // Convert to human-readable numbers
  const divisor = 10 ** decimals
  const points = rawPoints.map(p => ({
    t: p.t,
    b: Number(p.b) / divisor,
  }))

  return { points, decimals }
}
