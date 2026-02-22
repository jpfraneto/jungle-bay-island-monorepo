import {
  createPublicClient,
  formatUnits,
  http,
  parseAbiItem,
} from 'viem'
import { base, mainnet } from 'viem/chains'
import { calculateHeatDegrees, calculateTWAB, type BalanceSnapshot } from './heat'

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
  holders: {
    wallet: string
    heatDegrees: number
    balanceRaw: string
    firstSeenAt: number
    lastTransferAt: number
  }[]
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BLOCK_RANGE = 10_000
const MAX_CONCURRENT = 20
const DELAY_MS = 50
const MAX_RETRIES = 3
const MIN_HEAT_DEGREES = 0.01

const BASE_ANCHOR_BLOCK = 23_205_873n
const BASE_ANCHOR_TS = 1733201093
const BASE_BLOCK_TIME = 2

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

const ERC20_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const ERC721_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

type TransferEvent = {
  from: string
  to: string
  value: bigint
  blockNumber: bigint
  logIndex: number
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

function estimateBaseTimestamp(blockNumber: bigint): number {
  return BASE_ANCHOR_TS + Number(blockNumber - BASE_ANCHOR_BLOCK) * BASE_BLOCK_TIME
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

function mapLogToEvent(log: any, isNft: boolean, timestamp: number): TransferEvent {
  const value = isNft ? 1n : (log.args.value as bigint)
  return {
    from: String(log.args.from).toLowerCase(),
    to: String(log.args.to).toLowerCase(),
    value,
    blockNumber: log.blockNumber as bigint,
    logIndex: Number(log.logIndex ?? 0),
    timestamp,
  }
}

async function getLogsRange(
  client: ReturnType<typeof getClient>,
  tokenAddress: `0x${string}`,
  isNft: boolean,
  fromBlock: number,
  toBlock: number,
  rpcCounter: { count: number },
): Promise<any[]> {
  rpcCounter.count += 1
  return withRetry(() => client.getLogs({
    address: tokenAddress,
    event: isNft ? ERC721_TRANSFER : ERC20_TRANSFER,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  }))
}

async function hasAnyTransferInRange(
  client: ReturnType<typeof getClient>,
  tokenAddress: `0x${string}`,
  isNft: boolean,
  fromBlock: number,
  toBlock: number,
  rpcCounter: { count: number },
): Promise<{ exists: boolean; firstBlock: number | null }> {
  const logs = await getLogsRange(client, tokenAddress, isNft, fromBlock, toBlock, rpcCounter)
  if (logs.length === 0) return { exists: false, firstBlock: null }

  let first = Number(logs[0].blockNumber)
  for (const log of logs) {
    const bn = Number(log.blockNumber)
    if (bn < first) first = bn
  }
  return { exists: true, firstBlock: first }
}

async function findDeployBlock(
  client: ReturnType<typeof getClient>,
  tokenAddress: `0x${string}`,
  isNft: boolean,
  headBlock: number,
  rpcCounter: { count: number },
): Promise<number> {
  const overall = await hasAnyTransferInRange(client, tokenAddress, isNft, 0, headBlock, rpcCounter)
  if (!overall.exists || overall.firstBlock === null) {
    throw new Error('No Transfer events found for token')
  }

  let low = 0
  let high = headBlock

  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2)
    const left = await hasAnyTransferInRange(client, tokenAddress, isNft, low, mid, rpcCounter)
    if (left.exists) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  for (let start = low; start <= high; start += 100) {
    const end = Math.min(start + 99, high)
    const chunk = await hasAnyTransferInRange(client, tokenAddress, isNft, start, end, rpcCounter)
    if (chunk.exists && chunk.firstBlock !== null) return chunk.firstBlock
  }

  return overall.firstBlock
}

async function buildEthereumTimestampMap(
  client: ReturnType<typeof getClient>,
  events: { blockNumber: bigint }[],
  rpcCounter: { count: number },
): Promise<Map<bigint, number>> {
  const uniqueBlockNumbers = [...new Set(events.map((event) => event.blockNumber))].sort((a, b) => (a < b ? -1 : 1))
  const blockTimestamps = new Map<bigint, number>()

  for (let i = 0; i < uniqueBlockNumbers.length; i += MAX_CONCURRENT) {
    const batch = uniqueBlockNumbers.slice(i, i + MAX_CONCURRENT)
    const results = await Promise.all(
      batch.map(async (blockNumber) => {
        rpcCounter.count += 1
        const block = await withRetry(() => client.getBlock({ blockNumber }))
        return { blockNumber, timestamp: Number(block.timestamp) }
      }),
    )

    for (const item of results) {
      blockTimestamps.set(item.blockNumber, item.timestamp)
    }

    if (i + MAX_CONCURRENT < uniqueBlockNumbers.length) {
      await sleep(DELAY_MS)
    }
  }

  return blockTimestamps
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
    if (ledger.balance <= 0n) continue

    const twab = calculateTWAB(ledger.snapshots, deployTimestamp, nowTimestamp)
    const normalizedTwab = decimals > 0 ? twab / (10 ** decimals) : twab
    const heat = calculateHeatDegrees(normalizedTwab, totalSupply)

    if (heat < MIN_HEAT_DEGREES) continue

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
  onProgress?: (progress: { phase: string; pct: number }) => void,
): Promise<ScanResult> {
  const client = getClient(chain)
  const checksumAddress = tokenAddress.toLowerCase() as `0x${string}`
  const rpcCounter = { count: 0 }

  onProgress?.({ phase: 'metadata', pct: 5 })
  const metadata = await getTokenMetadata(client, checksumAddress, rpcCounter)

  rpcCounter.count += 1
  const headBlock = Number(await withRetry(() => client.getBlockNumber()))

  onProgress?.({ phase: 'deploy_block', pct: 10 })
  const deployBlock = await findDeployBlock(client, checksumAddress, metadata.isNft, headBlock, rpcCounter)

  const deployTimestamp =
    chain === 'base'
      ? estimateBaseTimestamp(BigInt(deployBlock))
      : await (async () => {
        rpcCounter.count += 1
        const block = await withRetry(() => client.getBlock({ blockNumber: BigInt(deployBlock) }))
        return Number(block.timestamp)
      })()

  onProgress?.({ phase: 'transfer_logs', pct: 20 })
  const ranges: Array<{ from: number; to: number }> = []
  for (let from = deployBlock; from <= headBlock; from += BLOCK_RANGE) {
    ranges.push({ from, to: Math.min(from + BLOCK_RANGE - 1, headBlock) })
  }

  const rawLogs: any[] = []
  for (let i = 0; i < ranges.length; i += MAX_CONCURRENT) {
    const batch = ranges.slice(i, i + MAX_CONCURRENT)
    const batchLogs = await Promise.all(
      batch.map((range) =>
        getLogsRange(client, checksumAddress, metadata.isNft, range.from, range.to, rpcCounter),
      ),
    )

    for (const logs of batchLogs) rawLogs.push(...logs)

    const pct = 20 + Math.floor(((i + batch.length) / ranges.length) * 35)
    onProgress?.({ phase: 'transfer_logs', pct })

    if (i + MAX_CONCURRENT < ranges.length) {
      await sleep(DELAY_MS)
    }
  }

  let blockTimestamps = new Map<bigint, number>()
  if (chain === 'ethereum') {
    onProgress?.({ phase: 'timestamps', pct: 60 })
    blockTimestamps = await buildEthereumTimestampMap(client, rawLogs as { blockNumber: bigint }[], rpcCounter)
  }

  onProgress?.({ phase: 'balances', pct: 75 })
  const events: TransferEvent[] = (rawLogs as any[])
    .map((log) => {
      const timestamp =
        chain === 'base'
          ? estimateBaseTimestamp(log.blockNumber as bigint)
          : (blockTimestamps.get(log.blockNumber as bigint) ?? Math.floor(Date.now() / 1000))
      return mapLogToEvent(log, metadata.isNft, timestamp)
    })
    .sort((a, b) => {
      if (a.blockNumber < b.blockNumber) return -1
      if (a.blockNumber > b.blockNumber) return 1
      return a.logIndex - b.logIndex
    })

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

  onProgress?.({ phase: 'heat', pct: 90 })
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
    eventsFetched: rawLogs.length,
    rpcCallsMade: rpcCounter.count,
    holders,
  }
}
