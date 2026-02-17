/**
 * index-and-calculate.ts
 *
 * Direct indexing script that bypasses Ponder entirely.
 * Fetches all Transfer events via eth_getLogs, builds balance history
 * in memory, calculates TWAB + Heat, and writes to heat_precalculated.
 *
 * Run:
 *   bun run scripts/index-and-calculate.ts
 *
 * Requires .env.local with:
 *   PONDER_RPC_URL_8453  — Base RPC
 *   PONDER_RPC_URL_1     — Ethereum RPC
 *   DATABASE_URL          — Postgres connection string
 */

import postgres from "postgres";
import {
  createPublicClient,
  http,
  formatUnits,
  parseAbiItem,
  type Log,
} from "viem";
import { base, mainnet } from "viem/chains";

// ─── Config ────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const K = 60; // Heat formula constant
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BLOCK_RANGE = 10_000; // blocks per eth_getLogs call
const ETH_BLOCK_RANGE = 50_000; // Ethereum has fewer events, bigger range
const MAX_CONCURRENT = 20; // concurrent RPC requests
const DELAY_MS = 50; // delay between batches to avoid rate limits

// ─── Transfer event signatures ─────────────────────────────────
const ERC20_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
const ERC721_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

// ─── Token Registry ────────────────────────────────────────────
interface TokenConfig {
  address: `0x${string}`;
  name: string;
  chain: "base" | "ethereum";
  deployBlock: number;
  deployTimestamp: number;
  decimals: number;
  fallbackSupply: number;
  isNFT: boolean;
}

const TOKENS: TokenConfig[] = [
  { address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", name: "BNKR",   chain: "base",     deployBlock: 23_205_873, deployTimestamp: 1733201093, decimals: 18, fallbackSupply: 100_000_000_000,  isNFT: false },
  { address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238", name: "RIZZ",   chain: "base",     deployBlock: 24_886_320, deployTimestamp: 1736561987, decimals: 6,  fallbackSupply: 153_118_981,      isNFT: false },
  { address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca", name: "TOWELI", chain: "base",     deployBlock: 24_887_072, deployTimestamp: 1736563491, decimals: 18, fallbackSupply: 55_201_546,       isNFT: false },
  { address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf", name: "QR",     chain: "base",     deployBlock: 26_009_102, deployTimestamp: 1738807551, decimals: 18, fallbackSupply: 100_000_000_000,  isNFT: false },
  { address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d", name: "JBM",    chain: "base",     deployBlock: 26_223_051, deployTimestamp: 1739235449, decimals: 18, fallbackSupply: 100_000_000_000,  isNFT: false },
  { address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2", name: "DRB",    chain: "base",     deployBlock: 27_276_095, deployTimestamp: 1741341537, decimals: 18, fallbackSupply: 100_000_000_000,  isNFT: false },
  { address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f", name: "ALPHA",  chain: "base",     deployBlock: 33_127_106, deployTimestamp: 1753043559, decimals: 18, fallbackSupply: 100_000_000_000,  isNFT: false },
  { address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9", name: "JBC",    chain: "ethereum", deployBlock: 13_949_933, deployTimestamp: 1641446071, decimals: 0,  fallbackSupply: 5_555,            isNFT: true  },
];

const TOKEN_BY_ADDRESS = new Map(TOKENS.map((t) => [t.address, t]));
const BASE_TOKENS = TOKENS.filter((t) => t.chain === "base");
const ETH_TOKENS = TOKENS.filter((t) => t.chain === "ethereum");

// Mutable — populated by fetchLiveTokenData()
const liveSupplies = new Map<string, number>();
const liveDecimals = new Map<string, number>();

// ─── ABIs for on-chain queries ─────────────────────────────────
const erc20Abi = [
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const erc721Abi = [
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

// ─── Helpers ───────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1);
}

// ─── Step 1: Fetch live supply & decimals ──────────────────────
async function fetchLiveTokenData(baseClient: any, ethClient: any) {
  console.log("Fetching live totalSupply & decimals from chain...\n");

  for (const token of TOKENS) {
    const client = token.chain === "base" ? baseClient : ethClient;
    const addr = token.address;

    try {
      if (token.isNFT) {
        const supply = await client.readContract({ address: addr, abi: erc721Abi, functionName: "totalSupply" });
        liveSupplies.set(addr, Number(supply));
        liveDecimals.set(addr, 0);
        console.log(`   ${token.name.padEnd(6)} supply=${Number(supply)} (NFT)`);
      } else {
        const [decimals, rawSupply] = await Promise.all([
          client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address: addr, abi: erc20Abi, functionName: "totalSupply" }),
        ]);
        const humanSupply = Number(formatUnits(rawSupply, decimals));
        liveSupplies.set(addr, humanSupply);
        liveDecimals.set(addr, decimals);
        console.log(`   ${token.name.padEnd(6)} decimals=${decimals} supply=${humanSupply.toLocaleString()}`);
      }
    } catch (err) {
      console.warn(`   ${token.name.padEnd(6)} RPC failed, using fallback: ${(err as Error).message?.slice(0, 60)}`);
      liveSupplies.set(addr, token.fallbackSupply);
      liveDecimals.set(addr, token.decimals);
    }
  }
  console.log();
}

// ─── Step 2: Fetch Transfer logs ───────────────────────────────

interface TransferEvent {
  token: `0x${string}`;
  from: string;
  to: string;
  value: bigint; // ERC-20: token amount, ERC-721: 1n
  blockNumber: bigint;
  timestamp?: number; // filled in later
}

async function fetchBaseTransferLogs(client: any): Promise<TransferEvent[]> {
  const earliestBlock = Math.min(...BASE_TOKENS.map((t) => t.deployBlock));
  const headBlock = Number(await client.getBlockNumber());
  const addresses = BASE_TOKENS.map((t) => t.address);
  const totalCalls = Math.ceil((headBlock - earliestBlock) / BLOCK_RANGE);

  console.log(`   Base: blocks ${earliestBlock.toLocaleString()} -> ${headBlock.toLocaleString()} (${totalCalls.toLocaleString()} calls)`);

  const allEvents: TransferEvent[] = [];
  let callsMade = 0;

  // Build all range tasks
  const ranges: { from: number; to: number }[] = [];
  for (let from = earliestBlock; from <= headBlock; from += BLOCK_RANGE) {
    ranges.push({ from, to: Math.min(from + BLOCK_RANGE - 1, headBlock) });
  }

  // Process in concurrent batches
  for (let i = 0; i < ranges.length; i += MAX_CONCURRENT) {
    const batch = ranges.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async (range) => {
      const logs = await client.getLogs({
        event: ERC20_TRANSFER,
        address: addresses,
        fromBlock: BigInt(range.from),
        toBlock: BigInt(range.to),
      });
      return logs.map((log: { address: string; blockNumber: bigint; args: { from?: string; to?: string; value?: bigint } }) => ({
        token: log.address.toLowerCase() as `0x${string}`,
        from: (log.args.from!).toLowerCase(),
        to: (log.args.to!).toLowerCase(),
        value: log.args.value!,
        blockNumber: log.blockNumber,
      }));
    });

    const results = await Promise.all(promises);
    for (const events of results) {
      allEvents.push(...events);
    }

    callsMade += batch.length;
    if (callsMade % 100 === 0 || callsMade === ranges.length) {
      process.stdout.write(`\r   Base: ${callsMade}/${totalCalls} calls, ${allEvents.length.toLocaleString()} events`);
    }

    if (i + MAX_CONCURRENT < ranges.length) await sleep(DELAY_MS);
  }

  console.log(`\r   Base: ${callsMade}/${totalCalls} calls, ${allEvents.length.toLocaleString()} events total${"".padEnd(20)}`);
  return allEvents;
}

async function fetchEthTransferLogs(client: any): Promise<TransferEvent[]> {
  const jbc = ETH_TOKENS[0];
  const headBlock = Number(await client.getBlockNumber());
  const totalCalls = Math.ceil((headBlock - jbc.deployBlock) / ETH_BLOCK_RANGE);

  console.log(`   Ethereum: blocks ${jbc.deployBlock.toLocaleString()} -> ${headBlock.toLocaleString()} (${totalCalls.toLocaleString()} calls)`);

  const allEvents: TransferEvent[] = [];
  let callsMade = 0;

  const ranges: { from: number; to: number }[] = [];
  for (let from = jbc.deployBlock; from <= headBlock; from += ETH_BLOCK_RANGE) {
    ranges.push({ from, to: Math.min(from + ETH_BLOCK_RANGE - 1, headBlock) });
  }

  // Process in concurrent batches
  for (let i = 0; i < ranges.length; i += MAX_CONCURRENT) {
    const batch = ranges.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async (range) => {
      const logs = await client.getLogs({
        event: ERC721_TRANSFER,
        address: [jbc.address],
        fromBlock: BigInt(range.from),
        toBlock: BigInt(range.to),
      });
      return logs.map((log: { address: string; blockNumber: bigint; args: { from?: string; to?: string } }) => ({
        token: log.address.toLowerCase() as `0x${string}`,
        from: (log.args.from!).toLowerCase(),
        to: (log.args.to!).toLowerCase(),
        value: 1n, // NFT: each transfer = 1 unit
        blockNumber: log.blockNumber,
      }));
    });

    const results = await Promise.all(promises);
    for (const events of results) {
      allEvents.push(...events);
    }

    callsMade += batch.length;
    if (callsMade % 50 === 0 || callsMade === ranges.length) {
      process.stdout.write(`\r   Ethereum: ${callsMade}/${totalCalls} calls, ${allEvents.length.toLocaleString()} events`);
    }

    if (i + MAX_CONCURRENT < ranges.length) await sleep(DELAY_MS);
  }

  console.log(`\r   Ethereum: ${callsMade}/${totalCalls} calls, ${allEvents.length.toLocaleString()} events total${"".padEnd(20)}`);
  return allEvents;
}

// ─── Step 3: Resolve block timestamps ──────────────────────────

// Base has a fixed 2-second block time. Use a known anchor to calculate.
// Anchor: BNKR deploy block 23,205,873 = unix 1733201093
const BASE_ANCHOR_BLOCK = 23_205_873n;
const BASE_ANCHOR_TS = 1733201093;
const BASE_BLOCK_TIME = 2; // seconds

function estimateBaseTimestamp(blockNumber: bigint): number {
  return BASE_ANCHOR_TS + Number(blockNumber - BASE_ANCHOR_BLOCK) * BASE_BLOCK_TIME;
}

function applyBaseTimestamps(events: TransferEvent[]): void {
  const uniqueBlocks = new Set<bigint>();
  for (const e of events) uniqueBlocks.add(e.blockNumber);
  console.log(`   Base: calculating timestamps for ${uniqueBlocks.size.toLocaleString()} unique blocks (2s block time)`);
  for (const e of events) {
    e.timestamp = estimateBaseTimestamp(e.blockNumber);
  }
  console.log(`   Base: done`);
}

// Ethereum has variable block times — resolve via RPC (only ~13K blocks)
async function resolveEthTimestamps(
  events: TransferEvent[],
  client: any,
): Promise<void> {
  const uniqueBlocks = new Set<bigint>();
  for (const e of events) uniqueBlocks.add(e.blockNumber);

  const blockNumbers = [...uniqueBlocks].sort((a, b) => (a < b ? -1 : 1));
  console.log(`   Ethereum: resolving ${blockNumbers.length.toLocaleString()} unique block timestamps via RPC...`);

  const blockTimestamps = new Map<bigint, number>();
  let resolved = 0;

  for (let i = 0; i < blockNumbers.length; i += MAX_CONCURRENT) {
    const batch = blockNumbers.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async (bn) => {
      const block = await client.getBlock({ blockNumber: bn });
      return { blockNumber: bn, timestamp: Number(block.timestamp) };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      blockTimestamps.set(r.blockNumber, r.timestamp);
    }

    resolved += batch.length;
    if (resolved % 200 === 0 || resolved === blockNumbers.length) {
      process.stdout.write(`\r   Ethereum: ${resolved}/${blockNumbers.length.toLocaleString()} blocks resolved`);
    }

    if (i + MAX_CONCURRENT < blockNumbers.length) await sleep(DELAY_MS);
  }

  console.log(`\r   Ethereum: ${resolved}/${blockNumbers.length.toLocaleString()} blocks resolved${"".padEnd(20)}`);

  for (const e of events) {
    e.timestamp = blockTimestamps.get(e.blockNumber)!;
  }
}

// ─── Step 4: Build balance history in memory ───────────────────
// Key: "wallet:token" -> sorted array of { timestamp, balance }
type BalanceHistory = Map<string, { timestamp: number; balance: bigint }[]>;

function buildBalanceHistory(events: TransferEvent[]): BalanceHistory {
  // Sort all events by block number (chronological)
  events.sort((a, b) => {
    if (a.blockNumber < b.blockNumber) return -1;
    if (a.blockNumber > b.blockNumber) return 1;
    return 0;
  });

  // Current balance per wallet:token
  const currentBalance = new Map<string, bigint>();
  const history: BalanceHistory = new Map();

  for (const event of events) {
    const { token, from, to, value, timestamp } = event;
    if (!timestamp) continue;

    // Sender side (deduct)
    if (from !== ZERO_ADDRESS) {
      const key = `${from}:${token}`;
      const prev = currentBalance.get(key) ?? 0n;
      const newBal = prev - value;
      currentBalance.set(key, newBal);

      if (!history.has(key)) history.set(key, []);
      history.get(key)!.push({ timestamp, balance: newBal });
    }

    // Receiver side (add)
    if (to !== ZERO_ADDRESS) {
      const key = `${to}:${token}`;
      const prev = currentBalance.get(key) ?? 0n;
      const newBal = prev + value;
      currentBalance.set(key, newBal);

      if (!history.has(key)) history.set(key, []);
      history.get(key)!.push({ timestamp, balance: newBal });
    }
  }

  return history;
}

// ─── Step 5: Calculate TWAB + Heat ─────────────────────────────
function calculateTWAB(
  snapshots: { timestamp: number; balance: bigint }[],
  deployTimestamp: number,
  nowTimestamp: number
): number {
  if (snapshots.length === 0) return 0;

  const totalDuration = nowTimestamp - deployTimestamp;
  if (totalDuration <= 0) return 0;

  let weightedSum = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const balance = Number(snapshots[i].balance);
    const start = snapshots[i].timestamp;
    const end = i < snapshots.length - 1 ? snapshots[i + 1].timestamp : nowTimestamp;
    const duration = end - start;

    if (duration > 0 && balance > 0) {
      weightedSum += balance * duration;
    }
  }

  return weightedSum / totalDuration;
}

function calculateHeatDegrees(twab: number, totalSupply: number): number {
  const rawHeat = twab / totalSupply;
  return 100 * (1 - Math.exp(-K * rawHeat));
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const scriptStart = Date.now();
  const now = Math.floor(Date.now() / 1000);

  console.log("=== Jungle Bay Island — Direct Indexer + Heat Calculator ===");
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log(`   Tokens: ${TOKENS.length} (${BASE_TOKENS.length} Base ERC-20, ${ETH_TOKENS.length} Ethereum ERC-721)\n`);

  // ── Create RPC clients ──
  const baseClient = createPublicClient({
    chain: base,
    transport: http(process.env.PONDER_RPC_URL_8453),
  });
  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http(process.env.PONDER_RPC_URL_1),
  });

  // ── Step 1: Fetch live supply & decimals ──
  await fetchLiveTokenData(baseClient, ethClient);

  // ── Step 2: Fetch all Transfer logs ──
  console.log("Fetching Transfer logs...\n");
  const fetchStart = Date.now();

  const [baseEvents, ethEvents] = await Promise.all([
    fetchBaseTransferLogs(baseClient),
    fetchEthTransferLogs(ethClient),
  ]);

  const totalEvents = baseEvents.length + ethEvents.length;
  console.log(`\n   Total: ${totalEvents.toLocaleString()} Transfer events fetched in ${elapsed(fetchStart)}s\n`);

  // ── Step 3: Resolve block timestamps ──
  console.log("Resolving block timestamps...\n");
  const tsStart = Date.now();

  // Base: calculate from block number (fixed 2s block time, instant)
  applyBaseTimestamps(baseEvents);
  // Ethereum: fetch via RPC (only ~13K unique blocks)
  await resolveEthTimestamps(ethEvents, ethClient);

  console.log(`\n   Timestamps resolved in ${elapsed(tsStart)}s\n`);

  // ── Step 4: Build balance history ──
  console.log("Building balance history in memory...\n");
  const buildStart = Date.now();

  const allEvents = [...baseEvents, ...ethEvents];
  const history = buildBalanceHistory(allEvents);

  console.log(`   ${history.size.toLocaleString()} wallet-token pairs built in ${elapsed(buildStart)}s\n`);

  // ── Step 5: Calculate Heat ──
  console.log("Calculating TWAB and Heat degrees...\n");
  const calcStart = Date.now();

  // Map: wallet -> { token -> degrees }
  const walletHeats = new Map<string, Map<string, number>>();
  let processed = 0;
  let skipped = 0;
  let withHeat = 0;

  for (const [key, snapshots] of history) {
    const [wallet, token] = key.split(":") as [string, `0x${string}`];
    const config = TOKEN_BY_ADDRESS.get(token);
    processed++;

    if (!config) { skipped++; continue; }

    const supply = liveSupplies.get(token) ?? config.fallbackSupply;
    const decimals = liveDecimals.get(token) ?? config.decimals;

    const twab = calculateTWAB(snapshots, config.deployTimestamp, now);
    const normalizedTwab = decimals > 0 ? twab / (10 ** decimals) : twab;
    const degrees = calculateHeatDegrees(normalizedTwab, supply);

    if (degrees < 0.01) { skipped++; continue; }

    if (!walletHeats.has(wallet)) walletHeats.set(wallet, new Map());
    walletHeats.get(wallet)!.set(token, degrees);
    withHeat++;

    if (processed % 10_000 === 0) {
      const pct = ((processed / history.size) * 100).toFixed(1);
      process.stdout.write(`\r   ${pct}% (${processed.toLocaleString()}/${history.size.toLocaleString()}) | ${withHeat.toLocaleString()} with heat`);
    }
  }

  console.log(`\r   Done: ${processed.toLocaleString()} pairs, ${withHeat.toLocaleString()} with heat, ${skipped.toLocaleString()} skipped (${elapsed(calcStart)}s)${"".padEnd(20)}\n`);

  // ── Step 6: Calculate Island Heat (sum of per-token heats) ──
  type WalletResult = {
    wallet: string;
    islandHeat: number;
    tokenBreakdown: { token: string; name: string; degrees: number }[];
  };

  const results: WalletResult[] = [];

  for (const [wallet, tokens] of walletHeats) {
    let islandHeat = 0;
    const breakdown: WalletResult["tokenBreakdown"] = [];

    for (const [token, degrees] of tokens) {
      islandHeat += degrees;
      const config = TOKEN_BY_ADDRESS.get(token as `0x${string}`);
      breakdown.push({
        token,
        name: config?.name ?? "?",
        degrees: Math.round(degrees * 100) / 100,
      });
    }

    results.push({
      wallet,
      islandHeat: Math.round(islandHeat * 100) / 100,
      tokenBreakdown: breakdown.sort((a, b) => b.degrees - a.degrees),
    });
  }

  results.sort((a, b) => b.islandHeat - a.islandHeat);

  // ── Step 7: Write to database (schema: prod-v11) ──
  const SCHEMA = "prod-v11";
  console.log(`Writing results to "${SCHEMA}".heat_precalculated...\n`);

  const sql = postgres(DATABASE_URL);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.heat_precalculated (
      wallet TEXT NOT NULL,
      token TEXT NOT NULL,
      token_name TEXT NOT NULL,
      heat_degrees NUMERIC NOT NULL,
      island_heat NUMERIC NOT NULL,
      calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (wallet, token)
    )
  `;

  await sql`TRUNCATE ${sql(SCHEMA)}.heat_precalculated`;

  // Flatten all rows
  const rows: { wallet: string; token: string; token_name: string; heat_degrees: number; island_heat: number }[] = [];
  for (const result of results) {
    for (const tkn of result.tokenBreakdown) {
      rows.push({
        wallet: result.wallet,
        token: tkn.token,
        token_name: tkn.name,
        heat_degrees: tkn.degrees,
        island_heat: result.islandHeat,
      });
    }
  }

  const BATCH_SIZE = 500;
  const writeStart = Date.now();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO ${sql(SCHEMA)}.heat_precalculated ${sql(batch, "wallet", "token", "token_name", "heat_degrees", "island_heat")}
    `;
    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= rows.length) {
      process.stdout.write(`\r   Inserted ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()}/${rows.length.toLocaleString()} rows...`);
    }
  }
  console.log(`\r   Inserted ${rows.length.toLocaleString()} rows for ${results.length.toLocaleString()} wallets in ${elapsed(writeStart)}s${"".padEnd(20)}\n`);

  // ── Step 8: Print summary ──
  console.log("===================================================");
  console.log("  TOP 20 WARMEST WALLETS ON THE ISLAND");
  console.log("===================================================\n");

  for (const r of results.slice(0, 20)) {
    const short = `${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)}`;
    const tokens = r.tokenBreakdown
      .map((t) => `${t.name}:${t.degrees.toFixed(1)}`)
      .join(" ");
    console.log(`  ${r.islandHeat.toFixed(1).padStart(7)}  ${short}  ${tokens}`);
  }

  // Tier breakdown
  const observers = results.filter((r) => r.islandHeat >= 30).length;
  const residents = results.filter((r) => r.islandHeat >= 80).length;
  const builders = results.filter((r) => r.islandHeat >= 150).length;
  const elders = results.filter((r) => r.islandHeat >= 250).length;

  console.log("\n===================================================");
  console.log("  TIER DISTRIBUTION");
  console.log("===================================================\n");
  console.log(`  Observers (30+):   ${observers}`);
  console.log(`  Residents (80+):   ${residents}`);
  console.log(`  Builders  (150+):  ${builders}`);
  console.log(`  Elders    (250+):  ${elders}`);
  console.log(`  Total wallets:     ${results.length}`);

  console.log(`\n  Total script time: ${elapsed(scriptStart)}s\n`);

  await sql.end();
  console.log("Done. Run resolve-farcaster.ts next to update Farcaster profiles.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
