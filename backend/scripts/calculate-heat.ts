/**
 * calculate-heat.ts
 *
 * Standalone script that queries the Ponder database and calculates
 * Heat degrees for every wallet-token pair.
 *
 * Run AFTER the indexer has synced:
 *   npx tsx scripts/calculate-heat.ts
 *
 * Requires DATABASE_URL env var pointing to the Ponder Postgres database.
 * The Ponder schema is "public" by default (or whatever --schema you used).
 */

import postgres from "postgres";
import { createPublicClient, http, formatUnits } from "viem";
import { base, mainnet } from "viem/chains";

// ─── Config ────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL!;
const PONDER_SCHEMA = process.env.PONDER_SCHEMA ?? "public";

// Heat formula constant (k=60, tuned for lower scores)
const K = 60;

// ─── Token registry ────────────────────────────────────────────
// Which chain each token lives on (determines which RPC to query)
const TOKEN_CHAIN: Record<string, "base" | "ethereum"> = {
  "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d": "base",     // JBM
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": "base",     // BNKR
  "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2": "base",     // DRB
  "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f": "base",     // ALPHA
  "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf": "base",     // QR
  "0x58d6e314755c2668f3d7358cc7a7a06c4314b238": "base",     // RIZZ
  "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca": "base",     // TOWELI
  "0xd37264c71e9af940e49795f0d3a8336afaafdda9": "ethereum", // JBC
};

// Fallback values — used if on-chain query fails
const FALLBACK_SUPPLIES: Record<string, number> = {
  "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d": 100_000_000_000,    // JBM
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": 100_000_000_000,    // BNKR
  "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2": 100_000_000_000,    // DRB
  "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f": 100_000_000_000,    // ALPHA
  "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf": 100_000_000_000,    // QR
  "0x58d6e314755c2668f3d7358cc7a7a06c4314b238": 153_118_981,        // RIZZ
  "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca": 55_201_546,         // TOWELI
  "0xd37264c71e9af940e49795f0d3a8336afaafdda9": 5_555,              // JBC
};

const FALLBACK_DECIMALS: Record<string, number> = {
  "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d": 18, // JBM
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": 18, // BNKR
  "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2": 18, // DRB
  "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f": 18, // ALPHA
  "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf": 18, // QR
  "0x58d6e314755c2668f3d7358cc7a7a06c4314b238": 6,  // RIZZ
  "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca": 18, // TOWELI
  "0xd37264c71e9af940e49795f0d3a8336afaafdda9": 0,  // JBC (NFT)
};

// Mutable — populated by fetchLiveTokenData(), falls back to above
const TOKEN_SUPPLIES: Record<string, number> = { ...FALLBACK_SUPPLIES };
const TOKEN_DECIMALS: Record<string, number> = { ...FALLBACK_DECIMALS };

// ─── On-chain supply/decimals query ─────────────────────────────
const erc20Abi = [
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const erc721Abi = [
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

async function fetchLiveTokenData() {
  const baseClient = createPublicClient({
    chain: base,
    transport: http(process.env.PONDER_RPC_URL_8453),
  });
  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http(process.env.PONDER_RPC_URL_1),
  });

  console.log("🔗 Fetching live totalSupply & decimals from chain...\n");

  for (const [address, chain] of Object.entries(TOKEN_CHAIN)) {
    const client = chain === "base" ? baseClient : ethClient;
    const name = TOKEN_NAMES[address] ?? address;
    const addr = address as `0x${string}`;

    try {
      if (chain === "ethereum" && address === "0xd37264c71e9af940e49795f0d3a8336afaafdda9") {
        // ERC-721: no decimals(), totalSupply() returns NFT count
        const supply = await client.readContract({ address: addr, abi: erc721Abi, functionName: "totalSupply" });
        const liveSupply = Number(supply);
        const changed = liveSupply !== FALLBACK_SUPPLIES[address];
        TOKEN_SUPPLIES[address] = liveSupply;
        TOKEN_DECIMALS[address] = 0;
        console.log(`   ${name.padEnd(6)} supply=${liveSupply} (NFT)${changed ? ` ← CHANGED from ${FALLBACK_SUPPLIES[address]}` : ""}`);
      } else {
        // ERC-20: query decimals() and totalSupply()
        const [decimals, rawSupply] = await Promise.all([
          client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address: addr, abi: erc20Abi, functionName: "totalSupply" }),
        ]);
        const humanSupply = Number(formatUnits(rawSupply, decimals));
        const changed = Math.abs(humanSupply - FALLBACK_SUPPLIES[address]) > 1;
        TOKEN_SUPPLIES[address] = humanSupply;
        TOKEN_DECIMALS[address] = decimals;
        console.log(`   ${name.padEnd(6)} decimals=${decimals} supply=${humanSupply.toLocaleString()}${changed ? ` ← CHANGED from ${FALLBACK_SUPPLIES[address].toLocaleString()}` : ""}`);
      }
    } catch (err) {
      console.warn(`   ${name.padEnd(6)} ⚠️  RPC query failed, using fallback (${(err as Error).message?.slice(0, 60)})`);
    }
  }

  console.log();
}

const TOKEN_NAMES: Record<string, string> = {
  "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d": "JBM",
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": "BNKR",
  "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2": "DRB",
  "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f": "ALPHA",
  "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf": "QR",
  "0x58d6e314755c2668f3d7358cc7a7a06c4314b238": "RIZZ",
  "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca": "TOWELI",
  "0xd37264c71e9af940e49795f0d3a8336afaafdda9": "JBC",
};

// Token deployment timestamps (unix seconds) — from block explorer creation txs
const TOKEN_DEPLOY_TIMESTAMPS: Record<string, number> = {
  "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d": 1739235449, // JBM    — 2025-02-11 block 26,223,051
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": 1733201093, // BNKR   — 2024-12-03 block 23,205,873
  "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2": 1741341537, // DRB    — 2025-03-07 block 27,276,095
  "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f": 1753043559, // ALPHA  — 2025-07-20 block 33,127,106
  "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf": 1738807551, // QR     — 2025-02-06 block 26,009,102
  "0x58d6e314755c2668f3d7358cc7a7a06c4314b238": 1736561987, // RIZZ   — 2025-01-11 block 24,886,320
  "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca": 1736563491, // TOWELI — 2025-01-11 block 24,887,072
  "0xd37264c71e9af940e49795f0d3a8336afaafdda9": 1641446071, // JBC    — 2022-01-06 block 13,949,933
};

// ─── Heat Formula ──────────────────────────────────────────────
function calculateHeatDegrees(twab: number, totalSupply: number): number {
  const rawHeat = twab / totalSupply;
  return 100 * (1 - Math.exp(-K * rawHeat));
}

// ─── TWAB from balance snapshots ───────────────────────────────
// Takes an array of { timestamp, balance } sorted by timestamp ASC.
// Returns the time-weighted average balance from deployTimestamp to now.
function calculateTWAB(
  snapshots: { timestamp: number; balance: bigint }[],
  deployTimestamp: number,
  nowTimestamp: number
): number {
  if (snapshots.length === 0) return 0;

  const totalDuration = nowTimestamp - deployTimestamp;
  if (totalDuration <= 0) return 0;

  let weightedSum = 0;

  // Before first snapshot, balance was 0
  // (from deploy time to first snapshot time, balance = 0, contributes nothing)

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

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const sql = postgres(DATABASE_URL);
  const now = Math.floor(Date.now() / 1000);

  console.log("🌡️  Jungle Bay Island — Heat Calculator");
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   Schema: ${PONDER_SCHEMA}`);
  console.log(`   Timestamp: ${new Date().toISOString()}\n`);

  // ── Step 0: Fetch live on-chain supply & decimals ──
  await fetchLiveTokenData();

  // ── Step 1: Fetch balance snapshots per token ──
  console.log("📊 Fetching balance snapshots per token...\n");
  const fetchStart = Date.now();

  const tokenAddresses = Object.keys(TOKEN_DEPLOY_TIMESTAMPS);
  const grouped = new Map<string, { timestamp: number; balance: bigint }[]>();
  let totalSnapshots = 0;

  for (const token of tokenAddresses) {
    const tokenName = TOKEN_NAMES[token] ?? token.slice(0, 10);
    const tokenStart = Date.now();
    const snapshots = await sql`
      SELECT wallet, timestamp, balance
      FROM ${sql(PONDER_SCHEMA)}.balance_snapshot
      WHERE token = ${token}
      ORDER BY wallet, timestamp ASC
    `;
    const elapsed = ((Date.now() - tokenStart) / 1000).toFixed(1);
    console.log(`   ${tokenName.padEnd(6)} ${snapshots.length.toLocaleString().padStart(9)} snapshots (${elapsed}s)`);
    totalSnapshots += snapshots.length;

    for (const s of snapshots) {
      const key = `${s.wallet}:${token}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({
        timestamp: Number(s.timestamp),
        balance: BigInt(s.balance),
      });
    }
  }

  const fetchElapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
  console.log(`\n   Total: ${totalSnapshots.toLocaleString()} snapshots, ${grouped.size.toLocaleString()} wallet-token pairs (${fetchElapsed}s)\n`);

  // ── Step 2: Calculate Heat degrees ──

  // Map: wallet -> { token -> degrees }
  const walletHeats: Map<string, Map<string, number>> = new Map();

  let processed = 0;
  let skipped = 0;
  let withHeat = 0;
  const startTime = Date.now();

  for (const [key, snapshots] of grouped) {
    const [wallet, token] = key.split(":");
    const deployTs = TOKEN_DEPLOY_TIMESTAMPS[token];
    processed++;

    if (processed % 5000 === 0 || processed === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = ((processed / grouped.size) * 100).toFixed(1);
      const rate = Math.round(processed / ((Date.now() - startTime) / 1000));
      process.stdout.write(`\r   ${pct}% (${processed.toLocaleString()}/${grouped.size.toLocaleString()}) ${rate.toLocaleString()} pairs/s | ${withHeat.toLocaleString()} with heat | ${elapsed}s`);
    }

    if (deployTs === undefined) { skipped++; continue; }

    const supply = TOKEN_SUPPLIES[token];
    if (!supply) { skipped++; continue; }

    // Calculate TWAB (returns raw balance units, i.e. with decimals)
    const twab = calculateTWAB(snapshots, deployTs, now);

    // Normalize TWAB from raw units to human-readable units
    const decimals = TOKEN_DECIMALS[token] ?? 18;
    const normalizedTwab = twab / (10 ** decimals);
    const degrees = calculateHeatDegrees(normalizedTwab, supply);
    if (degrees < 0.01) { skipped++; continue; } // Skip dust

    // Store in map
    if (!walletHeats.has(wallet)) walletHeats.set(wallet, new Map());
    walletHeats.get(wallet)!.set(token, degrees);
    withHeat++;
  }

  // Final line after progress
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\r   Done: ${processed.toLocaleString()} pairs in ${totalElapsed}s | ${withHeat.toLocaleString()} with heat, ${skipped.toLocaleString()} skipped${"".padEnd(20)}`);

  // ── Step 3: Calculate Island Heat (sum of per-token heats) ──
  console.log(`\n🏝️  Calculating Island Heat for ${walletHeats.size} wallets...\n`);

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
      breakdown.push({
        token,
        name: TOKEN_NAMES[token] ?? "?",
        degrees: Math.round(degrees * 100) / 100,
      });
    }

    results.push({
      wallet,
      islandHeat: Math.round(islandHeat * 100) / 100,
      tokenBreakdown: breakdown.sort((a, b) => b.degrees - a.degrees),
    });
  }

  // Sort by Island Heat descending
  results.sort((a, b) => b.islandHeat - a.islandHeat);

  // ── Step 4: Write results to heat_precalculated table ──
  console.log("💾 Writing results to heat_precalculated table...\n");

  // Create the output table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS heat_precalculated (
      wallet TEXT NOT NULL,
      token TEXT NOT NULL,
      token_name TEXT NOT NULL,
      heat_degrees NUMERIC NOT NULL,
      island_heat NUMERIC NOT NULL,
      calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (wallet, token)
    )
  `;

  // Clear previous calculations
  await sql`TRUNCATE heat_precalculated`;

  // Flatten all rows for batch insert
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

  // Batch insert 500 rows at a time (single round-trip per batch)
  const BATCH_SIZE = 500;
  const writeStart = Date.now();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO heat_precalculated ${sql(batch, "wallet", "token", "token_name", "heat_degrees", "island_heat")}
    `;
    process.stdout.write(`\r   Inserted ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()}/${rows.length.toLocaleString()} rows...`);
  }
  const writeElapsed = ((Date.now() - writeStart) / 1000).toFixed(1);
  console.log(`\r   Inserted ${rows.length.toLocaleString()} rows for ${results.length.toLocaleString()} wallets in ${writeElapsed}s${"".padEnd(20)}\n`);

  // ── Step 5: Print summary ──
  console.log("═══════════════════════════════════════════════════");
  console.log("  TOP 20 WARMEST WALLETS ON THE ISLAND");
  console.log("═══════════════════════════════════════════════════\n");

  for (const r of results.slice(0, 20)) {
    const short = `${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)}`;
    const tokens = r.tokenBreakdown
      .map((t) => `${t.name}:${t.degrees.toFixed(1)}°`)
      .join(" ");
    console.log(`  ${r.islandHeat.toFixed(1).padStart(7)}°  ${short}  ${tokens}`);
  }

  // Tier breakdown
  const observers = results.filter((r) => r.islandHeat >= 30).length;
  const residents = results.filter((r) => r.islandHeat >= 80).length;
  const builders = results.filter((r) => r.islandHeat >= 150).length;
  const elders = results.filter((r) => r.islandHeat >= 250).length;

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TIER DISTRIBUTION");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(`  Observers (30°+):   ${observers}`);
  console.log(`  Residents (80°+):   ${residents}`);
  console.log(`  Builders  (150°+):  ${builders}`);
  console.log(`  Elders    (250°+):  ${elders}`);
  console.log(`  Total wallets:      ${results.length}\n`);

  await sql.end();
  console.log("✅ Done. The Island knows who its people are.\n");
}

main().catch(console.error);
