import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";

async function main() {
  const sql = postgres(DATABASE_URL);

  console.log("\n🌴 Jungle Bay Island — Migration v13\n");
  console.log(`   Schema: ${SCHEMA}`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Creating claim_daily_allocations...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.claim_daily_allocations (
      id BIGSERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL,
      identity_source TEXT NOT NULL,
      identity_value TEXT NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      period_id INTEGER NOT NULL,
      heat_degrees NUMERIC NOT NULL DEFAULT 0,
      reward_jbm NUMERIC NOT NULL DEFAULT 0,
      wallets_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      claimant_wallet TEXT,
      claim_nonce INTEGER,
      signature TEXT,
      amount_wei NUMERIC,
      deadline INTEGER,
      CONSTRAINT claim_daily_identity_period_unique
        UNIQUE (identity_key, chain, token_address, period_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_claim_daily_identity
    ON ${sql(SCHEMA)}.claim_daily_allocations (identity_key, period_id DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_claim_daily_token
    ON ${sql(SCHEMA)}.claim_daily_allocations (chain, token_address, period_id DESC)
  `;

  const claimHistoryTable = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${SCHEMA}
        AND table_name = 'claim_history'
    ) AS exists
  `;

  if (!claimHistoryTable[0]?.exists) {
    console.log("   claim_history not found, skipping backfill");
    await sql.end();
    console.log("\n✅ Migration v13 complete\n");
    return;
  }

  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${SCHEMA}
      AND table_name = 'claim_history'
  `;

  const has = (name: string) => columns.some((col) => col.column_name === name);

  if (!has("wallet") || !has("token_address")) {
    console.log("   claim_history is missing wallet/token_address columns, skipping backfill");
    await sql.end();
    console.log("\n✅ Migration v13 complete\n");
    return;
  }

  console.log("   Backfilling claim_history -> claim_daily_allocations...");

  const chainExpr = has("chain") ? "COALESCE(ch.chain, 'base')" : "'base'";
  const periodExpr = has("period_id")
    ? "COALESCE(ch.period_id, FLOOR((EXTRACT(EPOCH FROM COALESCE(ch.claimed_at, NOW())) - 43200) / 86400)::int)"
    : "FLOOR((EXTRACT(EPOCH FROM COALESCE(ch.claimed_at, NOW())) - 43200) / 86400)::int";
  const rewardExpr = has("amount")
    ? "CASE WHEN ch.amount::numeric >= 1000000000000000000 THEN FLOOR(ch.amount::numeric / 1000000000000000000) ELSE FLOOR(ch.amount::numeric) END"
    : "0";
  const claimedAtExpr = has("claimed_at") ? "ch.claimed_at" : "NOW()";
  const nonceExpr = has("nonce") ? "ch.nonce" : "NULL";
  const signatureExpr = has("signature") ? "ch.signature" : "NULL";
  const amountWeiExpr = has("amount") ? "ch.amount::numeric" : "NULL";

  const backfillQuery = `
    INSERT INTO "${SCHEMA}".claim_daily_allocations (
      identity_key,
      identity_source,
      identity_value,
      chain,
      token_address,
      period_id,
      heat_degrees,
      reward_jbm,
      wallets_snapshot,
      created_at,
      claimed_at,
      claimant_wallet,
      claim_nonce,
      signature,
      amount_wei
    )
    SELECT
      'wallet:' || LOWER(ch.wallet) AS identity_key,
      'wallet' AS identity_source,
      LOWER(ch.wallet) AS identity_value,
      ${chainExpr} AS chain,
      ch.token_address,
      ${periodExpr} AS period_id,
      0::numeric AS heat_degrees,
      ${rewardExpr} AS reward_jbm,
      '[]'::jsonb AS wallets_snapshot,
      ${claimedAtExpr} AS created_at,
      ${claimedAtExpr} AS claimed_at,
      LOWER(ch.wallet) AS claimant_wallet,
      ${nonceExpr} AS claim_nonce,
      ${signatureExpr} AS signature,
      ${amountWeiExpr} AS amount_wei
    FROM "${SCHEMA}".claim_history ch
    WHERE ch.wallet IS NOT NULL
      AND ch.token_address IS NOT NULL
    ON CONFLICT (identity_key, chain, token_address, period_id) DO NOTHING
  `;

  await sql.unsafe(backfillQuery);

  const countRows = await sql<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${sql(SCHEMA)}.claim_daily_allocations
  `;

  console.log(`   claim_daily_allocations rows: ${countRows[0]?.cnt ?? "0"}`);

  await sql.end();
  console.log("\n✅ Migration v13 complete\n");
}

main().catch((error) => {
  console.error("Migration v13 failed:", error);
  process.exit(1);
});
