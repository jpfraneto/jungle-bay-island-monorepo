/**
 * migrate-v12.ts — Island Bodega foundation migration
 *
 * Extends the active prod-v11 schema with:
 *   - Bodega catalog listings
 *   - Bodega install records
 *   - Additive bonus heat events
 *   - Signature-backed wallet links
 *
 * Safe to run multiple times — all tables and indexes are created idempotently.
 * For legacy installs, user_wallet_links is also upgraded in-place so the new
 * manual link API can coexist with older data until the old route is retired.
 *
 * Run:
 *   bun run --env-file .env.local scripts/migrate-v12.ts
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";

/**
 * Adds a column to an existing table when the legacy schema is missing it.
 */
async function ensureColumn(
  sql: postgres.Sql,
  tableName: string,
  columnDefinition: string,
): Promise<void> {
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}"."${tableName}" ADD COLUMN IF NOT EXISTS ${columnDefinition}`,
  );
}

async function main() {
  const sql = postgres(DATABASE_URL);
  const start = Date.now();

  console.log("\n🌴 Jungle Bay Island — Database Migration (prod-v11)\n");
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   Schema: ${SCHEMA}`);
  console.log(`   Timestamp: ${new Date().toISOString()}\n`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;
  console.log("   Schema ensured\n");

  // ── 1. Bodega Catalog ──
  console.log("   Creating bodega_catalog...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bodega_catalog (
      id SERIAL PRIMARY KEY,
      creator_wallet TEXT NOT NULL,
      creator_handle TEXT,
      origin_bungalow_token_address TEXT,
      origin_bungalow_chain TEXT,
      asset_type TEXT NOT NULL CHECK (
        asset_type IN ('decoration', 'miniapp', 'game', 'link', 'image')
      ),
      title TEXT NOT NULL,
      description TEXT,
      -- content payloads by asset_type:
      -- decoration: { preview_url, external_url, format: 'image' | 'glb' | 'usdz' }
      -- miniapp:    { url, name, description }
      -- game:       { url, name, description }
      -- link:       { url, title }
      -- image:      { image_url, caption }
      content JSONB NOT NULL,
      preview_url TEXT,
      price_in_jbm NUMERIC NOT NULL,
      install_count INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bodega_catalog_creator_wallet
    ON ${sql(SCHEMA)}.bodega_catalog (creator_wallet)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bodega_catalog_asset_type
    ON ${sql(SCHEMA)}.bodega_catalog (asset_type)
  `;
  console.log("   done");

  // ── 2. Bodega Installs ──
  console.log("   Creating bodega_installs...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bodega_installs (
      id SERIAL PRIMARY KEY,
      catalog_item_id INTEGER NOT NULL REFERENCES ${sql(SCHEMA)}.bodega_catalog(id),
      installed_to_token_address TEXT NOT NULL,
      installed_to_chain TEXT NOT NULL,
      installed_by_wallet TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      jbm_amount NUMERIC NOT NULL,
      creator_credit_jbm NUMERIC NOT NULL,
      credit_claimed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bodega_installs_catalog_item_id
    ON ${sql(SCHEMA)}.bodega_installs (catalog_item_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bodega_installs_bungalow
    ON ${sql(SCHEMA)}.bodega_installs (installed_to_token_address, installed_to_chain)
  `;
  console.log("   done");

  // ── 3. Bonus Heat Events ──
  console.log("   Creating bonus_heat_events...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bonus_heat_events (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (
        event_type IN ('item_added', 'bodega_install', 'bodega_submission')
      ),
      bonus_points INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bonus_heat_events_wallet_token
    ON ${sql(SCHEMA)}.bonus_heat_events (wallet, token_address)
  `;
  console.log("   done");

  // ── 4. User Wallet Links ──
  console.log("   Creating user_wallet_links...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.user_wallet_links (
      id SERIAL PRIMARY KEY,
      primary_wallet TEXT NOT NULL,
      linked_wallet TEXT NOT NULL,
      verification_signature TEXT NOT NULL,
      verification_message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (primary_wallet, linked_wallet)
    )
  `;

  // Legacy-safe column upgrades so existing prod-v11 installs can add the new
  // manual link layer without dropping older rows or constraints.
  await ensureColumn(sql, "user_wallet_links", "id BIGSERIAL");
  await ensureColumn(sql, "user_wallet_links", "primary_wallet TEXT");
  await ensureColumn(sql, "user_wallet_links", "linked_wallet TEXT");
  await ensureColumn(sql, "user_wallet_links", "verification_signature TEXT");
  await ensureColumn(sql, "user_wallet_links", "verification_message TEXT");
  await ensureColumn(
    sql,
    "user_wallet_links",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallet_links_primary_linked_unique
    ON "${SCHEMA}".user_wallet_links (primary_wallet, linked_wallet)
    WHERE primary_wallet IS NOT NULL AND linked_wallet IS NOT NULL
  `);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_wallet_links_primary_wallet
    ON ${sql(SCHEMA)}.user_wallet_links (primary_wallet)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_wallet_links_linked_wallet
    ON ${sql(SCHEMA)}.user_wallet_links (linked_wallet)
  `;
  console.log("   done");

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n   ==========================================");
  console.log("   MIGRATION COMPLETE");
  console.log("   ==========================================\n");

  const trackedTables = [
    "bodega_catalog",
    "bodega_installs",
    "bonus_heat_events",
    "user_wallet_links",
  ];

  console.log(`   Schema "${SCHEMA}" updated with ${trackedTables.length} Bodega tables:`);
  for (const tableName of trackedTables) {
    const count = await sql.unsafe<Array<{ cnt: string }>>(
      `SELECT COUNT(*)::text AS cnt FROM "${SCHEMA}"."${tableName}"`,
    );
    console.log(`     - ${tableName.padEnd(30)} ${Number(count[0]?.cnt ?? 0).toLocaleString()} rows`);
  }

  console.log(`\n   Completed in ${elapsed}s\n`);

  await sql.end();
  console.log("🌴 Migration done. The island grows.\n");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
