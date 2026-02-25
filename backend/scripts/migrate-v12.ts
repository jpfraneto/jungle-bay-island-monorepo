import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";

async function main() {
  const sql = postgres(DATABASE_URL!);

  console.log("\n🌴 Jungle Bay Island — Migration v12\n");
  console.log(`   Schema: ${SCHEMA}`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Creating bungalow_items...");
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_bungalow_items_token
    ON ${sql(SCHEMA)}.bungalow_items(token_address, chain)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_bungalow_items_placed_by
    ON ${sql(SCHEMA)}.bungalow_items(placed_by)
  `;

  console.log("   Creating claim_history...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.claim_history (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      nonce INTEGER NOT NULL,
      signature TEXT NOT NULL,
      claimed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_claim_history_wallet
    ON ${sql(SCHEMA)}.claim_history(wallet, token_address, chain)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_history_nonce
    ON ${sql(SCHEMA)}.claim_history(wallet, nonce)
  `;

  await sql.end();
  console.log("\n✅ Migration v12 complete\n");
}

main().catch((error) => {
  console.error("Migration v12 failed:", error);
  process.exit(1);
});
