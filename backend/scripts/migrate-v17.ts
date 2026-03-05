import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";

async function main() {
  const sql = postgres(DATABASE_URL);
  const start = Date.now();

  console.log("\n🌴 Jungle Bay Island — Migration v17\n");
  console.log(`   Schema: ${SCHEMA}`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Extending bodega_catalog for quick-add + moderation...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bodega_catalog (
      id SERIAL PRIMARY KEY,
      creator_wallet TEXT NOT NULL,
      creator_handle TEXT,
      origin_bungalow_token_address TEXT,
      origin_bungalow_chain TEXT,
      asset_type TEXT NOT NULL CHECK (
        asset_type IN (
          'decoration',
          'miniapp',
          'game',
          'link',
          'image',
          'frame',
          'portal'
        )
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
      moderated_reason TEXT,
      moderated_by TEXT,
      moderated_at TIMESTAMPTZ,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  for (const statement of [
    `ALTER TABLE "${SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_reason TEXT`,
    `ALTER TABLE "${SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_by TEXT`,
    `ALTER TABLE "${SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`,
  ]) {
    await sql.unsafe(statement);
  }

  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".bodega_catalog DROP CONSTRAINT IF EXISTS bodega_catalog_asset_type_check`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".bodega_catalog
     ADD CONSTRAINT bodega_catalog_asset_type_check
     CHECK (asset_type IN ('decoration', 'miniapp', 'game', 'link', 'image', 'frame', 'portal'))`,
  );

  console.log("   Extending bungalow_items for moderation...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bungalow_items (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK (item_type IN ('link', 'image', 'frame', 'portal')),
      content JSONB NOT NULL,
      placed_by TEXT NOT NULL,
      tx_hash TEXT UNIQUE NOT NULL,
      jbm_amount NUMERIC NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      moderated_reason TEXT,
      moderated_by TEXT,
      moderated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  for (const statement of [
    `ALTER TABLE "${SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE "${SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_reason TEXT`,
    `ALTER TABLE "${SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_by TEXT`,
    `ALTER TABLE "${SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`,
  ]) {
    await sql.unsafe(statement);
  }

  console.log("   Creating bungalow construction support/event tables...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bungalow_construction_supports (
      id BIGSERIAL PRIMARY KEY,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      supporter_wallet TEXT NOT NULL,
      island_heat NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (chain, token_address, identity_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bungalow_construction_supports_token
    ON ${sql(SCHEMA)}.bungalow_construction_supports (chain, token_address, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.bungalow_construction_events (
      id BIGSERIAL PRIMARY KEY,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      requested_by_wallet TEXT NOT NULL,
      qualification_path TEXT NOT NULL CHECK (
        qualification_path IN ('single_hot_wallet', 'community_support', 'jbac_shortcut')
      ),
      tx_hash TEXT UNIQUE NOT NULL,
      jbm_amount NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bungalow_construction_events_token
    ON ${sql(SCHEMA)}.bungalow_construction_events (chain, token_address, created_at DESC)
  `;

  const [catalogCount, supportCount, eventCount] = await Promise.all([
    sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${sql(SCHEMA)}.bodega_catalog
    `,
    sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${sql(SCHEMA)}.bungalow_construction_supports
    `,
    sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${sql(SCHEMA)}.bungalow_construction_events
    `,
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   bodega_catalog rows: ${catalogCount[0]?.cnt ?? "0"}`);
  console.log(`   bungalow_construction_supports rows: ${supportCount[0]?.cnt ?? "0"}`);
  console.log(`   bungalow_construction_events rows: ${eventCount[0]?.cnt ?? "0"}`);
  console.log(`   Completed in ${elapsed}s`);

  await sql.end();
  console.log("\n✅ Migration v17 complete\n");
}

main().catch((error: unknown) => {
  console.error(
    "Migration v17 failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
