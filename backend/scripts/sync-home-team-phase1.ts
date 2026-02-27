import { CONFIG, db, normalizeAddress } from "../src/config";
import {
  createScanLog,
  markScanFailed,
  setTokenStatus,
  updateBungalowMetadata,
  updateScanProgress,
  writeScanResult,
} from "../src/db/queries";
import { fetchDexScreenerData } from "../src/services/dexscreener";
import { scanSolanaToken } from "../src/services/solanaScanner";
import { scanToken } from "../src/services/scanner";

type HomeTeamChain = "base" | "ethereum" | "solana";

interface HomeTeamToken {
  chain: HomeTeamChain;
  token_address: string;
  name: string;
  symbol: string;
  image_url?: string | null;
}

interface RegistryRow {
  token_address: string;
  chain: HomeTeamChain;
  scan_status: string;
  is_home_team: boolean | null;
}

const HOME_TEAM_TOKENS: HomeTeamToken[] = [
  {
    chain: "ethereum",
    token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
    name: "Jungle Bay Collection",
    symbol: "JBAC",
    image_url: "https://opensea.io/collection/junglebay/opengraph-image",
  },
  { chain: "base", token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d", name: "Jungle Bay Memes", symbol: "JBM" },
  { chain: "base", token_address: "0x570b1533f6daa82814b25b62b5c7c4c55eb83947", name: "BOBO", symbol: "BOBO" },
  { chain: "ethereum", token_address: "0xb90b2a35c65dbc466b04240097ca756ad2005295", name: "BOBO", symbol: "BOBO" },
  { chain: "solana", token_address: "8NNXWrWVctNw1UFeaBypffimTdcLCcD8XJzHvYsmgwpF", name: "BRAINLET", symbol: "BRAINLET" },
  { chain: "base", token_address: "0xe3086852a4b125803c815a158249ae468a3254ca", name: "mfer", symbol: "MFER" },
  { chain: "base", token_address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", name: "BNKR", symbol: "BNKR" },
  { chain: "ethereum", token_address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", name: "PEPE", symbol: "PEPE" },
  { chain: "base", token_address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238", name: "RIZZ", symbol: "RIZZ" },
  { chain: "solana", token_address: "5ad4puH6yDBoeCcrQfwV5s9bxvPnAeWDoYDj3uLyBS8k", name: "RIZZ", symbol: "RIZZ" },
  { chain: "base", token_address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2", name: "DebtReliefBot", symbol: "DRB" },
  { chain: "base", token_address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f", name: "ALPHA", symbol: "ALPHA" },
  { chain: "base", token_address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf", name: "QR", symbol: "QR" },
  { chain: "ethereum", token_address: "0x420698cfdeddea6bc78d59bc17798113ad278f9d", name: "TOWELI", symbol: "TOWELI" },
  { chain: "base", token_address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca", name: "TOWELI", symbol: "TOWELI" },
];

const CLEANUP_TOKEN_ADDRESS_TABLES = [
  { table: "bulletin_posts", column: "token_address" },
  { table: "bungalow_items", column: "token_address" },
  { table: "bungalows", column: "token_address" },
  { table: "claim_daily_allocations", column: "token_address" },
  { table: "claim_history", column: "token_address" },
  { table: "custom_bungalows", column: "token_address" },
  { table: "holder_balance_snapshots", column: "token_address" },
  { table: "scan_log", column: "token_address" },
  { table: "token_holder_heat", column: "token_address" },
  { table: "token_registry", column: "token_address" },
] as const;

const CLEANUP_MINT_TABLES = [
  { table: "used_tx_hashes", column: "mint_address" },
] as const;

const SYSTEM_REQUESTER = "system:home-team-sync";
const DRY_RUN = process.env.DRY_RUN === "1";
const SCAN_TIMEOUT_MS = Number.parseInt(
  process.env.HOME_TEAM_SCAN_TIMEOUT_MS ?? String(20 * 60 * 1000),
  10,
);
const SCAN_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HOME_TEAM_SCAN_CONCURRENCY ?? "2", 10) || 2,
);

function normalizeTokenAddress(chain: HomeTeamChain, address: string): string {
  if (chain === "solana") {
    return address.trim();
  }
  const normalized = normalizeAddress(address);
  if (!normalized) {
    throw new Error(`Invalid EVM address for ${chain}: ${address}`);
  }
  return normalized;
}

function tokenKey(chain: HomeTeamChain, tokenAddress: string): string {
  return `${chain}:${tokenAddress}`;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${CONFIG.SCHEMA}
        AND table_name = ${table}
    ) AS exists
  `;

  return Boolean(rows[0]?.exists);
}

async function deleteNonHomeTeamRows(
  table: string,
  column: string,
  keepTokenAddresses: string[],
): Promise<number> {
  if (DRY_RUN) return 0;
  const result = await db.unsafe(
    `DELETE FROM "${CONFIG.SCHEMA}"."${table}" WHERE "${column}" <> ALL($1::text[])`,
    [keepTokenAddresses],
  );
  return Number(result.count ?? 0);
}

async function processScan(token: HomeTeamToken): Promise<{ success: boolean; error?: string }> {
  await setTokenStatus(token.token_address, token.chain, "scanning");

  const scanId = await createScanLog({
    tokenAddress: token.token_address,
    chain: token.chain,
    requestedBy: SYSTEM_REQUESTER,
    requesterFid: null,
    requesterTier: "system",
    paymentMethod: "admin",
    paymentAmount: 0,
  });

  try {
    const onProgress = (progress: { phase: string; pct: number; detail?: string }) => {
      void updateScanProgress(scanId, progress).catch(() => undefined);
    };

    const scanPromise = token.chain === "solana"
      ? scanSolanaToken(token.token_address, onProgress)
      : scanToken(token.chain, token.token_address, onProgress);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Scan timed out after ${Math.floor(SCAN_TIMEOUT_MS / 1000)}s`));
      }, SCAN_TIMEOUT_MS);
    });

    const result = await Promise.race([scanPromise, timeoutPromise]);

    await writeScanResult(scanId, result);

    if (token.chain !== "solana") {
      try {
        const dexData = await fetchDexScreenerData(token.token_address, token.chain);
        if (dexData) {
          await updateBungalowMetadata(token.token_address, dexData);
        }
      } catch {
        // DexScreener enrichment is best-effort and should not fail the scan.
      }
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error";
    await markScanFailed(scanId, token.token_address, message);
    return { success: false, error: message };
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  await Promise.all(
    Array.from({ length: safeConcurrency }).map(async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        await worker(items[current]);
      }
    }),
  );
}

async function main() {
  console.log("\n🌴 Jungle Bay Island — Home Team Sync (Phase 1)\n");
  console.log(`   Schema: ${CONFIG.SCHEMA}`);
  console.log(`   Dry run: ${DRY_RUN ? "yes" : "no"}`);
  console.log(`   Home Team token count: ${HOME_TEAM_TOKENS.length}`);
  console.log(`   Scan timeout (ms): ${SCAN_TIMEOUT_MS}`);
  console.log(`   Scan concurrency: ${SCAN_CONCURRENCY}`);

  const normalizedHomeTeam: HomeTeamToken[] = HOME_TEAM_TOKENS.map((token) => ({
    ...token,
    token_address: normalizeTokenAddress(token.chain, token.token_address),
  }));

  const dedupedByKey = new Map<string, HomeTeamToken>();
  for (const token of normalizedHomeTeam) {
    dedupedByKey.set(tokenKey(token.chain, token.token_address), token);
  }
  const homeTeam = [...dedupedByKey.values()];
  const keepTokenAddresses = homeTeam.map((token) => token.token_address);

  const existingRows = await db<RegistryRow[]>`
    SELECT
      token_address,
      chain,
      scan_status,
      is_home_team
    FROM ${db(CONFIG.SCHEMA)}.token_registry
  `;

  const existingByAddress = new Map<string, RegistryRow>();
  for (const row of existingRows) {
    existingByAddress.set(row.token_address, row);
  }

  const inserted: string[] = [];
  const chainChanged: string[] = [];
  const needsScan: HomeTeamToken[] = [];

  for (const token of homeTeam) {
    const previous = existingByAddress.get(token.token_address);
    if (!previous) {
      inserted.push(tokenKey(token.chain, token.token_address));
      needsScan.push(token);
    } else if (previous.chain !== token.chain) {
      chainChanged.push(`${token.token_address}: ${previous.chain} -> ${token.chain}`);
      needsScan.push(token);
    } else if (previous.scan_status !== "complete") {
      needsScan.push(token);
    }

    if (!DRY_RUN) {
      await db`
        INSERT INTO ${db(CONFIG.SCHEMA)}.token_registry (
          token_address,
          chain,
          name,
          symbol,
          is_home_team,
          scan_status
        )
        VALUES (
          ${token.token_address},
          ${token.chain},
          ${token.name},
          ${token.symbol},
          TRUE,
          'pending'
        )
        ON CONFLICT (token_address) DO UPDATE SET
          chain = EXCLUDED.chain,
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          is_home_team = TRUE
      `;

      await db`
        UPDATE ${db(CONFIG.SCHEMA)}.bungalows
        SET
          chain = ${token.chain},
          name = ${token.name},
          symbol = ${token.symbol},
          image_url = COALESCE(${token.image_url ?? null}, image_url)
        WHERE token_address = ${token.token_address}
      `;

      await db`
        INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
          token_address,
          chain,
          name,
          symbol,
          holder_count,
          total_supply,
          image_url,
          updated_at
        )
        VALUES (
          ${token.token_address},
          ${token.chain},
          ${token.name},
          ${token.symbol},
          0,
          0,
          ${token.image_url ?? null},
          NOW()
        )
        ON CONFLICT (token_address) DO UPDATE SET
          chain = EXCLUDED.chain,
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          image_url = COALESCE(EXCLUDED.image_url, bungalows.image_url),
          updated_at = NOW()
      `;
    }
  }

  // Keep bungalow chain aligned with token_registry chain for same token_address.
  if (!DRY_RUN) {
    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.bungalows b
      SET chain = tr.chain
      FROM ${db(CONFIG.SCHEMA)}.token_registry tr
      WHERE b.token_address = tr.token_address
        AND b.chain <> tr.chain
    `;
  }

  const removedRows = await db<Array<{ token_address: string; chain: string }>>`
    SELECT token_address, chain
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    WHERE token_address <> ALL(${keepTokenAddresses}::text[])
    ORDER BY chain, token_address
  `;

  const cleanupCounts: Array<{ table: string; deleted: number }> = [];

  for (const target of CLEANUP_TOKEN_ADDRESS_TABLES) {
    if (!(await tableExists(target.table))) continue;
    const deleted = await deleteNonHomeTeamRows(target.table, target.column, keepTokenAddresses);
    cleanupCounts.push({ table: target.table, deleted });
  }

  for (const target of CLEANUP_MINT_TABLES) {
    if (!(await tableExists(target.table))) continue;
    const deleted = await deleteNonHomeTeamRows(target.table, target.column, keepTokenAddresses);
    cleanupCounts.push({ table: target.table, deleted });
  }

  if (DRY_RUN) {
    console.log("\nDry-run summary:");
    console.log(`   Would insert: ${inserted.length}`);
    console.log(`   Would chain-fix: ${chainChanged.length}`);
    console.log(`   Would remove non-home-team tokens: ${removedRows.length}`);
    console.log(`   Would scan: ${needsScan.length}`);
    if (inserted.length > 0) console.log(`   Insert list: ${inserted.join(", ")}`);
    if (chainChanged.length > 0) console.log(`   Chain fixes: ${chainChanged.join(", ")}`);
    if (removedRows.length > 0) {
      console.log(
        `   Remove list: ${removedRows.map((row) => tokenKey(row.chain as HomeTeamChain, row.token_address)).join(", ")}`,
      );
    }
    console.log("\n✅ Dry run complete\n");
    return;
  }

  const scanSuccess: string[] = [];
  const scanFailures: Array<{ key: string; error: string }> = [];

  const scanQueue = [...needsScan].sort((a, b) => {
    const priority = (token: HomeTeamToken): number => {
      if (token.chain === "solana") return 0;
      if (token.token_address === "0x6982508145454ce325ddbe47a25d4ec3d2311933") return 3; // PEPE last
      return 1;
    };
    return priority(a) - priority(b);
  });

  await runWithConcurrency(scanQueue, SCAN_CONCURRENCY, async (token) => {
    const key = tokenKey(token.chain, token.token_address);
    console.log(`   Scanning ${key}...`);
    const outcome = await processScan(token);
    if (outcome.success) {
      scanSuccess.push(key);
      console.log(`   Scan OK ${key}`);
      return;
    }
    scanFailures.push({
      key,
      error: outcome.error ?? "unknown_error",
    });
    console.log(`   Scan FAIL ${key}: ${outcome.error ?? "unknown_error"}`);
  });

  const finalRows = await db<Array<{ chain: string; token_address: string; scan_status: string }>>`
    SELECT chain, token_address, scan_status
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    ORDER BY chain, token_address
  `;

  console.log("\nSync summary:");
  console.log(`   Inserted: ${inserted.length}`);
  console.log(`   Chain fixed: ${chainChanged.length}`);
  console.log(`   Removed from token_registry: ${removedRows.length}`);
  console.log(`   Scanned ok: ${scanSuccess.length}`);
  console.log(`   Scan failed: ${scanFailures.length}`);
  console.log(`   Final token_registry count: ${finalRows.length}`);

  if (removedRows.length > 0) {
    console.log(
      `   Removed tokens: ${removedRows.map((row) => tokenKey(row.chain as HomeTeamChain, row.token_address)).join(", ")}`,
    );
  }

  for (const row of cleanupCounts) {
    console.log(`   Cleanup ${row.table}: deleted=${row.deleted}`);
  }

  if (scanFailures.length > 0) {
    console.log("   Failed scans:");
    for (const failed of scanFailures) {
      console.log(`     - ${failed.key}: ${failed.error}`);
    }
  }

  console.log("\n✅ Home Team sync complete\n");
}

main()
  .catch((error) => {
    console.error("Home Team sync failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.end({ timeout: 5 });
  });
