import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";
const DAILY_CLAIM_CAP_JBM = Number.parseInt(
  process.env.DAILY_CLAIM_CAP_JBM ?? "10000000",
  10,
);

async function main() {
  const sql = postgres(DATABASE_URL);

  console.log("\n🌴 Jungle Bay Island — Migration v14\n");
  console.log(`   Schema: ${SCHEMA}`);
  console.log(`   Daily cap: ${DAILY_CLAIM_CAP_JBM.toLocaleString()} JBM`);

  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(SCHEMA)}`;

  console.log("   Creating claim_period_caps...");
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.claim_period_caps (
      period_id INTEGER PRIMARY KEY,
      cap_jbm NUMERIC NOT NULL,
      distributed_jbm NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE ${sql(SCHEMA)}.claim_period_caps
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;

  const allocationsTable = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${SCHEMA}
        AND table_name = 'claim_daily_allocations'
    ) AS exists
  `;

  if (!allocationsTable[0]?.exists) {
    console.log("   claim_daily_allocations not found, skipping backfill");
    await sql.end();
    console.log("\n✅ Migration v14 complete\n");
    return;
  }

  console.log("   Backfilling claim_period_caps from claimed allocations...");
  const backfillQuery = `
    WITH period_claims AS (
      SELECT
        period_id,
        COALESCE(
          SUM(
            CASE
              WHEN claimed_at IS NULL THEN 0
              WHEN amount_wei IS NOT NULL AND amount_wei > 0
                THEN FLOOR(amount_wei / 1000000000000000000)
              ELSE GREATEST(FLOOR(reward_jbm), 0)
            END
          ),
          0
        )::numeric AS distributed_jbm
      FROM "${SCHEMA}".claim_daily_allocations
      GROUP BY period_id
    )
    INSERT INTO "${SCHEMA}".claim_period_caps (
      period_id,
      cap_jbm,
      distributed_jbm
    )
    SELECT
      period_id,
      ${Math.max(0, DAILY_CLAIM_CAP_JBM)}::numeric AS cap_jbm,
      distributed_jbm
    FROM period_claims
    ON CONFLICT (period_id) DO UPDATE
    SET
      cap_jbm = EXCLUDED.cap_jbm,
      distributed_jbm = GREATEST(
        "${SCHEMA}".claim_period_caps.distributed_jbm,
        EXCLUDED.distributed_jbm
      ),
      updated_at = NOW()
  `;

  await sql.unsafe(backfillQuery);

  const rowCount = await sql<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${sql(SCHEMA)}.claim_period_caps
  `;

  const latest = await sql<{ period_id: number; cap_jbm: string; distributed_jbm: string }[]>`
    SELECT period_id, cap_jbm::text AS cap_jbm, distributed_jbm::text AS distributed_jbm
    FROM ${sql(SCHEMA)}.claim_period_caps
    ORDER BY period_id DESC
    LIMIT 1
  `;

  console.log(`   claim_period_caps rows: ${rowCount[0]?.cnt ?? "0"}`);
  if (latest[0]) {
    console.log(
      `   latest period ${latest[0].period_id}: cap=${latest[0].cap_jbm}, distributed=${latest[0].distributed_jbm}`,
    );
  }

  await sql.end();
  console.log("\n✅ Migration v14 complete\n");
}

main().catch((error) => {
  console.error("Migration v14 failed:", error);
  process.exit(1);
});
