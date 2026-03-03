/**
 * migrate-v15.ts — Persist Bodega submission payment proof
 *
 * Extends bodega_catalog with:
 *   - submission_tx_hash
 *   - submission_fee_jbm
 *
 * Safe to run multiple times. Existing rows remain valid and keep NULL values
 * until they are resubmitted or backfilled.
 *
 * Run:
 *   bun run --env-file .env.local scripts/migrate-v15.ts
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";

/**
 * Adds a column to an existing table when the live schema is missing it.
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

  console.log("\n🌴 Jungle Bay Island — Migration v15\n");
  console.log(`   Schema: ${SCHEMA}`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Ensuring bodega_catalog payment-proof columns...");
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
      content JSONB NOT NULL,
      preview_url TEXT,
      price_in_jbm NUMERIC NOT NULL,
      install_count INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      submission_tx_hash TEXT,
      submission_fee_jbm NUMERIC,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await ensureColumn(sql, "bodega_catalog", "submission_tx_hash TEXT");
  await ensureColumn(sql, "bodega_catalog", "submission_fee_jbm NUMERIC");

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bodega_catalog_submission_tx_hash_unique
    ON "${SCHEMA}".bodega_catalog (submission_tx_hash)
    WHERE submission_tx_hash IS NOT NULL
  `);

  const count = await sql<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${sql(SCHEMA)}.bodega_catalog
  `;

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   bodega_catalog rows: ${count[0]?.cnt ?? "0"}`);
  console.log(`   Completed in ${elapsed}s`);

  await sql.end();
  console.log("\n✅ Migration v15 complete\n");
}

main().catch((error: unknown) => {
  console.error(
    "Migration v15 failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
