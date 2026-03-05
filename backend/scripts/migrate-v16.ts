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

  console.log("\n🌴 Jungle Bay Island — Migration v16\n");
  console.log(`   Schema: ${SCHEMA}`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Ensuring users table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      privy_user_id TEXT UNIQUE NOT NULL,
      x_username TEXT UNIQUE,
      email TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".users ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid()`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".users ADD COLUMN IF NOT EXISTS privy_user_id TEXT`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".users ADD COLUMN IF NOT EXISTS x_username TEXT`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".users ADD COLUMN IF NOT EXISTS email TEXT`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  );

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_privy_user_id_unique
    ON "${SCHEMA}".users (privy_user_id)
  `);

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_x_username_unique
    ON "${SCHEMA}".users (x_username)
    WHERE x_username IS NOT NULL
  `);

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON "${SCHEMA}".users (email)
    WHERE email IS NOT NULL
  `);

  console.log("   Ensuring user_wallets table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.user_wallets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      privy_user_id TEXT NOT NULL REFERENCES ${sql(SCHEMA)}.users(privy_user_id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'privy_siwe',
      linked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(privy_user_id, address)
    )
  `;

  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".user_wallets ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid()`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".user_wallets ADD COLUMN IF NOT EXISTS privy_user_id TEXT`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".user_wallets ADD COLUMN IF NOT EXISTS address TEXT`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".user_wallets ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'privy_siwe'`,
  );
  await sql.unsafe(
    `ALTER TABLE "${SCHEMA}".user_wallets ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ DEFAULT NOW()`,
  );

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_privy_user_address_unique
    ON "${SCHEMA}".user_wallets (privy_user_id, address)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_user_wallets_address
    ON "${SCHEMA}".user_wallets (address)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_user_wallets_privy_user_id
    ON "${SCHEMA}".user_wallets (privy_user_id)
  `);

  const [usersCount, walletsCount] = await Promise.all([
    sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${sql(SCHEMA)}.users
    `,
    sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${sql(SCHEMA)}.user_wallets
    `,
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   users rows: ${usersCount[0]?.cnt ?? "0"}`);
  console.log(`   user_wallets rows: ${walletsCount[0]?.cnt ?? "0"}`);
  console.log(`   Completed in ${elapsed}s`);

  await sql.end();
  console.log("\n✅ Migration v16 complete\n");
}

main().catch((error: unknown) => {
  console.error(
    "Migration v16 failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
