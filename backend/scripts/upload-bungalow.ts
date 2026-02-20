/**
 * upload-bungalow.ts — Upload a custom bungalow HTML file to the database
 *
 * Usage:
 *   bun run --env-file .env.local scripts/upload-bungalow.ts --chain base --ca 0xabc... --file ./path/to/index.html
 *
 * Optional flags:
 *   --claimed-by "wallet or name"
 *   --note "DM'd on X 2026-02-20"
 */

import { parseArgs } from "util";
import postgres from "postgres";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    chain: { type: "string", default: "base" },
    ca: { type: "string" },
    file: { type: "string" },
    "claimed-by": { type: "string" },
    note: { type: "string" },
  },
  strict: true,
});

const chain = values.chain ?? "base";
const ca = values.ca;
const filePath = values.file;
const claimedBy = values["claimed-by"] ?? null;
const contactNote = values.note ?? null;

if (!ca || !filePath) {
  console.error("Usage: bun run scripts/upload-bungalow.ts --chain base --ca 0x... --file ./index.html");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const SCHEMA = process.env.DB_SCHEMA ?? "prod-v11";
const tokenAddress = ca.toLowerCase();

const htmlFile = Bun.file(filePath);
if (!(await htmlFile.exists())) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const html = await htmlFile.text();
console.log(`Read ${html.length} chars from ${filePath}`);

const sql = postgres(DATABASE_URL);

await sql`
  INSERT INTO ${sql(SCHEMA)}.custom_bungalows (
    token_address, chain, html, claimed_by, contact_note
  )
  VALUES (
    ${tokenAddress}, ${chain}, ${html}, ${claimedBy}, ${contactNote}
  )
  ON CONFLICT (token_address, chain)
  DO UPDATE SET
    html = EXCLUDED.html,
    claimed_by = COALESCE(EXCLUDED.claimed_by, ${sql(SCHEMA)}.custom_bungalows.claimed_by),
    contact_note = COALESCE(EXCLUDED.contact_note, ${sql(SCHEMA)}.custom_bungalows.contact_note),
    is_active = TRUE,
    updated_at = NOW()
`;

console.log(`Uploaded custom bungalow for ${chain}/${tokenAddress}`);
if (claimedBy) console.log(`  claimed_by: ${claimedBy}`);
if (contactNote) console.log(`  note: ${contactNote}`);

await sql.end();
console.log("Done.");
