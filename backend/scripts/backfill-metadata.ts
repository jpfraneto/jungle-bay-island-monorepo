/**
 * backfill-metadata.ts — Backfill DexScreener metadata for existing bungalows
 *
 * Fetches token images, prices, and social links from DexScreener
 * for any bungalow that hasn't been enriched yet.
 *
 * Run:
 *   bun run --env-file .env.local scripts/backfill-metadata.ts
 */

import postgres from "postgres";
import { fetchDexScreenerData } from "../src/services/dexscreener";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = "prod-v11";
const DELAY_MS = 1100; // Stay under 60 req/min

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sql = postgres(DATABASE_URL);
  const start = Date.now();

  console.log("\n🌴 Backfill DexScreener Metadata\n");

  const rows = await sql<{ token_address: string; chain: string }[]>`
    SELECT token_address, chain
    FROM ${sql(SCHEMA)}.bungalows
    WHERE image_url IS NULL OR metadata_updated_at IS NULL
    ORDER BY token_address
  `;

  console.log(`   Found ${rows.length} bungalows to enrich\n`);

  let success = 0;
  let skipped = 0;

  for (const row of rows) {
    console.log(`   Fetching: ${row.token_address} (${row.chain})...`);

    const data = await fetchDexScreenerData(row.token_address, row.chain);

    if (data) {
      await sql`
        UPDATE ${sql(SCHEMA)}.bungalows
        SET
          image_url = COALESCE(image_url, ${data.imageUrl}),
          price_usd = ${data.priceUsd},
          market_cap = ${data.marketCap},
          volume_24h = ${data.volume24h},
          liquidity_usd = ${data.liquidityUsd},
          link_website = COALESCE(link_website, ${data.linkWebsite}),
          link_x = COALESCE(link_x, ${data.linkX}),
          link_telegram = COALESCE(link_telegram, ${data.linkTelegram}),
          link_dexscreener = COALESCE(link_dexscreener, ${data.linkDexscreener}),
          metadata_updated_at = NOW()
        WHERE token_address = ${row.token_address}
      `;
      success++;
      console.log(`     OK — price=$${data.priceUsd} mcap=$${data.marketCap} image=${Boolean(data.imageUrl)}`);
    } else {
      skipped++;
      console.log("     No data from DexScreener");
    }

    await sleep(DELAY_MS);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n   Done in ${elapsed}s — ${success} enriched, ${skipped} skipped\n`);

  await sql.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
