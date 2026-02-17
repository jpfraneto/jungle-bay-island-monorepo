/**
 * migrate-v11.ts — Database migration for Jungle Bay Island app layer
 *
 * Adds new tables to the prod-v11 schema to support:
 *   - Token registry (scanned tokens, both Home Team and user-discovered)
 *   - Per-token holder heat (heat scores for holders of any scanned token)
 *   - Scan log (audit trail of who scanned what and how they paid)
 *   - Bungalows (off-chain mirror of on-chain state + enrichment)
 *   - Scan allowance (daily rate limit tracking for Residents)
 *
 * Safe to run multiple times — all statements use IF NOT EXISTS.
 * Does NOT modify or drop existing tables (heat_precalculated,
 * wallet_farcaster_profiles, fid_island_profiles).
 *
 * Run:
 *   bun run --env-file .env.local scripts/migrate-v11.ts
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const SCHEMA = "prod-v11";

async function main() {
  const sql = postgres(DATABASE_URL);
  const start = Date.now();

  console.log("\n🌴 Jungle Bay Island — Database Migration (prod-v11)\n");
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   Schema: ${SCHEMA}`);
  console.log(`   Timestamp: ${new Date().toISOString()}\n`);

  // Ensure schema exists
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;
  console.log("   Schema ensured\n");

  // ── 1. Token Registry ──
  console.log("   Creating token_registry...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.token_registry (
      token_address TEXT PRIMARY KEY,
      chain TEXT NOT NULL DEFAULT 'base',
      name TEXT,
      symbol TEXT,
      decimals INTEGER,
      total_supply NUMERIC,
      deploy_block INTEGER,
      deploy_timestamp INTEGER,
      is_home_team BOOLEAN DEFAULT FALSE,
      scan_status TEXT DEFAULT 'pending',
      last_scanned_at TIMESTAMP,
      last_scan_block INTEGER,
      holder_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("   done");

  // ── 2. Token Holder Heat ──
  console.log("   Creating token_holder_heat...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.token_holder_heat (
      token_address TEXT NOT NULL,
      wallet TEXT NOT NULL,
      heat_degrees NUMERIC NOT NULL,
      balance_raw TEXT,
      first_seen_at INTEGER,
      last_transfer_at INTEGER,
      calculated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (token_address, wallet)
    )
  `;
  // Index for looking up all holders of a token sorted by heat
  await sql`
    CREATE INDEX IF NOT EXISTS idx_thh_token_heat
    ON ${sql(SCHEMA)}.token_holder_heat (token_address, heat_degrees DESC)
  `;
  // Index for looking up all tokens a wallet holds
  await sql`
    CREATE INDEX IF NOT EXISTS idx_thh_wallet
    ON ${sql(SCHEMA)}.token_holder_heat (wallet)
  `;
  console.log("   done");

  // ── 3. Scan Log ──
  console.log("   Creating scan_log...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.scan_log (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'base',
      requested_by TEXT NOT NULL,
      requester_fid INTEGER,
      requester_tier TEXT,
      payment_method TEXT NOT NULL DEFAULT 'free_resident',
      payment_amount NUMERIC DEFAULT 0,
      scan_status TEXT DEFAULT 'pending',
      events_fetched INTEGER DEFAULT 0,
      holders_found INTEGER DEFAULT 0,
      rpc_calls_made INTEGER DEFAULT 0,
      started_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      error_message TEXT
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_scanlog_token
    ON ${sql(SCHEMA)}.scan_log (token_address)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_scanlog_requester
    ON ${sql(SCHEMA)}.scan_log (requested_by)
  `;
  console.log("   done");

  // ── 4. Bungalows ──
  console.log("   Creating bungalows...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bungalows (
      id SERIAL PRIMARY KEY,
      token_address TEXT UNIQUE NOT NULL,
      chain TEXT NOT NULL DEFAULT 'base',
      onchain_id INTEGER,
      name TEXT,
      symbol TEXT,
      ipfs_hash TEXT,
      current_owner TEXT,
      verified_admin TEXT,
      is_verified BOOLEAN DEFAULT FALSE,
      is_claimed BOOLEAN DEFAULT FALSE,
      description TEXT,
      origin_story TEXT,
      holder_count INTEGER DEFAULT 0,
      total_supply NUMERIC,
      link_x TEXT,
      link_farcaster TEXT,
      link_telegram TEXT,
      link_website TEXT,
      link_dexscreener TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bungalows_token
    ON ${sql(SCHEMA)}.bungalows (token_address)
  `;
  // Add metadata columns for DexScreener enrichment
  for (const col of [
    "image_url TEXT",
    "price_usd NUMERIC",
    "market_cap NUMERIC",
    "volume_24h NUMERIC",
    "liquidity_usd NUMERIC",
    "metadata_updated_at TIMESTAMP",
  ]) {
    await sql.unsafe(
      `ALTER TABLE "${SCHEMA}".bungalows ADD COLUMN IF NOT EXISTS ${col}`
    );
  }
  console.log("   done (+ metadata columns)");

  // ── 4b. Bulletin Posts ──
  console.log("   Creating bulletin_posts...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bulletin_posts (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'base',
      wallet TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bulletin_token_created
    ON ${sql(SCHEMA)}.bulletin_posts (token_address, created_at DESC)
  `;
  console.log("   done");

  // ── 5. Scan Allowance ──
  console.log("   Creating scan_allowance...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.scan_allowance (
      wallet TEXT NOT NULL,
      date DATE NOT NULL,
      scans_used INTEGER DEFAULT 0,
      PRIMARY KEY (wallet, date)
    )
  `;
  console.log("   done");

  // ── 6. Seed Home Team tokens into token_registry ──
  console.log("\n   Seeding Home Team tokens into token_registry...");

  const homeTeam = [
    { token_address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", chain: "base",     name: "BNKR",   symbol: "BNKR",   decimals: 18, total_supply: 100000000000, deploy_block: 23205873, deploy_timestamp: 1733201093 },
    { token_address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238", chain: "base",     name: "RIZZ",   symbol: "RIZZ",   decimals: 6,  total_supply: 153118981,    deploy_block: 24886320, deploy_timestamp: 1736561987 },
    { token_address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca", chain: "base",     name: "TOWELI", symbol: "TOWELI", decimals: 18, total_supply: 55201546,     deploy_block: 24887072, deploy_timestamp: 1736563491 },
    { token_address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf", chain: "base",     name: "QR",     symbol: "QR",     decimals: 18, total_supply: 100000000000, deploy_block: 26009102, deploy_timestamp: 1738807551 },
    { token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d", chain: "base",     name: "JBM",    symbol: "JBM",    decimals: 18, total_supply: 100000000000, deploy_block: 26223051, deploy_timestamp: 1739235449 },
    { token_address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2", chain: "base",     name: "DRB",    symbol: "DRB",    decimals: 18, total_supply: 100000000000, deploy_block: 27276095, deploy_timestamp: 1741341537 },
    { token_address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f", chain: "base",     name: "ALPHA",  symbol: "ALPHA",  decimals: 18, total_supply: 100000000000, deploy_block: 33127106, deploy_timestamp: 1753043559 },
    { token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9", chain: "ethereum", name: "JBC",    symbol: "JBC",    decimals: 0,  total_supply: 5555,         deploy_block: 13949933, deploy_timestamp: 1641446071 },
  ];

  for (const token of homeTeam) {
    await sql`
      INSERT INTO ${sql(SCHEMA)}.token_registry ${sql(
        token,
        "token_address", "chain", "name", "symbol", "decimals",
        "total_supply", "deploy_block", "deploy_timestamp"
      )}
      ON CONFLICT (token_address) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        decimals = EXCLUDED.decimals,
        total_supply = EXCLUDED.total_supply,
        deploy_block = EXCLUDED.deploy_block,
        deploy_timestamp = EXCLUDED.deploy_timestamp,
        is_home_team = TRUE,
        scan_status = 'complete'
    `;
  }

  // Mark all as home team + complete (they were scanned by index-and-calculate.ts)
  await sql`
    UPDATE ${sql(SCHEMA)}.token_registry
    SET is_home_team = TRUE, scan_status = 'complete', last_scanned_at = NOW()
    WHERE token_address IN ${sql(homeTeam.map((t) => t.token_address))}
  `;

  console.log(`   Seeded ${homeTeam.length} Home Team tokens`);

  // ── 7. Backfill token_holder_heat from heat_precalculated ──
  console.log("\n   Backfilling token_holder_heat from heat_precalculated...");

  const backfillResult = await sql`
    INSERT INTO ${sql(SCHEMA)}.token_holder_heat (token_address, wallet, heat_degrees, calculated_at)
    SELECT token, wallet, heat_degrees, calculated_at
    FROM ${sql(SCHEMA)}.heat_precalculated
    ON CONFLICT (token_address, wallet) DO UPDATE SET
      heat_degrees = EXCLUDED.heat_degrees,
      calculated_at = EXCLUDED.calculated_at
  `;

  const backfillCount = await sql`
    SELECT COUNT(*) as cnt FROM ${sql(SCHEMA)}.token_holder_heat
  `;
  console.log(`   Backfilled ${Number(backfillCount[0].cnt).toLocaleString()} holder-heat rows`);

  // ── 8. Seed bungalow stubs for Home Team tokens ──
  console.log("\n   Seeding bungalow stubs for Home Team tokens...");

  for (const token of homeTeam) {
    await sql`
      INSERT INTO ${sql(SCHEMA)}.bungalows (token_address, chain, name, symbol, total_supply, is_claimed, holder_count)
      VALUES (
        ${token.token_address},
        ${token.chain},
        ${token.name},
        ${token.symbol},
        ${token.total_supply},
        FALSE,
        COALESCE(
          (SELECT COUNT(DISTINCT wallet) FROM ${sql(SCHEMA)}.token_holder_heat WHERE token_address = ${token.token_address}),
          0
        )
      )
      ON CONFLICT (token_address) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        total_supply = EXCLUDED.total_supply,
        holder_count = EXCLUDED.holder_count,
        updated_at = NOW()
    `;
  }

  console.log(`   Seeded ${homeTeam.length} bungalow stubs`);

  // ── 9. Add indexes on existing tables if missing ──
  console.log("\n   Ensuring indexes on existing tables...");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_hp_token
    ON ${sql(SCHEMA)}.heat_precalculated (token)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_hp_wallet
    ON ${sql(SCHEMA)}.heat_precalculated (wallet)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_hp_island_heat
    ON ${sql(SCHEMA)}.heat_precalculated (island_heat DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_fip_heat
    ON ${sql(SCHEMA)}.fid_island_profiles (island_heat DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_fip_tier
    ON ${sql(SCHEMA)}.fid_island_profiles (tier)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_wfp_fid
    ON ${sql(SCHEMA)}.wallet_farcaster_profiles (fid)
  `;

  console.log("   done");

  // ── Summary ──
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n   ==========================================");
  console.log("   MIGRATION COMPLETE");
  console.log("   ==========================================\n");

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${SCHEMA}
    ORDER BY table_name
  `;

  console.log(`   Schema "${SCHEMA}" now contains ${tables.length} tables:`);
  for (const t of tables) {
    const count = await sql`
      SELECT COUNT(*) as cnt FROM ${sql(SCHEMA)}.${sql(t.table_name)}
    `;
    console.log(`     - ${t.table_name.padEnd(30)} ${Number(count[0].cnt).toLocaleString()} rows`);
  }

  console.log(`\n   Completed in ${elapsed}s\n`);

  await sql.end();
  console.log("🌴 Migration done. The island grows.\n");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
