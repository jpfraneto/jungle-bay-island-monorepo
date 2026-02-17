/**
 * resolve-farcaster.ts
 *
 * Cross-references wallets from heat_precalculated with Farcaster profiles
 * using the Neynar API. Writes results to wallet_farcaster_profiles table.
 *
 * Run:
 *   PONDER_SCHEMA=prod bun run scripts/resolve-farcaster.ts
 *
 * Requires:
 *   DATABASE_URL  — Postgres connection string
 *   NEYNAR_API_KEY — Neynar API key
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY!;
const NEYNAR_BATCH_SIZE = 350;
const SCHEMA = "prod-v11";

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}
if (!NEYNAR_API_KEY) {
  console.error("Missing NEYNAR_API_KEY");
  process.exit(1);
}

type NeynarUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
  neynar_user_score: number;
  verified_addresses: {
    eth_addresses: string[];
    sol_addresses: string[];
  };
};

type WalletHeat = {
  wallet: string;
  island_heat: number;
  token_breakdown: { token_name: string; heat_degrees: number }[];
};

async function fetchNeynarBatch(
  addresses: string[]
): Promise<Record<string, NeynarUser[]>> {
  const url = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${addresses.join(",")}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-api-key": NEYNAR_API_KEY },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Neynar API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  // Response shape: { [address]: NeynarUser[] }
  return json as Record<string, NeynarUser[]>;
}

async function main() {
  const sql = postgres(DATABASE_URL);

  console.log("🔮 Farcaster Profile Resolver");
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   Timestamp: ${new Date().toISOString()}\n`);

  // ── Step 1: Read wallets + heat from heat_precalculated ──
  console.log("📊 Reading wallets from heat_precalculated...\n");

  const heatRows = await sql`
    SELECT wallet, token_name, heat_degrees, island_heat
    FROM ${sql(SCHEMA)}.heat_precalculated
    ORDER BY island_heat DESC
  `;

  // Group by wallet
  const walletMap = new Map<string, WalletHeat>();
  for (const row of heatRows) {
    const w = row.wallet as string;
    if (!walletMap.has(w)) {
      walletMap.set(w, {
        wallet: w,
        island_heat: Number(row.island_heat),
        token_breakdown: [],
      });
    }
    walletMap.get(w)!.token_breakdown.push({
      token_name: row.token_name as string,
      heat_degrees: Number(row.heat_degrees),
    });
  }

  const wallets = Array.from(walletMap.keys());
  console.log(`   Found ${wallets.length.toLocaleString()} unique wallets\n`);

  // ── Step 2: Batch query Neynar API ──
  console.log("🔍 Querying Neynar API for Farcaster profiles...\n");

  const totalBatches = Math.ceil(wallets.length / NEYNAR_BATCH_SIZE);
  const resolved = new Map<
    string,
    { user: NeynarUser; wallet: string }
  >();

  for (let i = 0; i < wallets.length; i += NEYNAR_BATCH_SIZE) {
    const batch = wallets.slice(i, i + NEYNAR_BATCH_SIZE);
    const batchNum = Math.floor(i / NEYNAR_BATCH_SIZE) + 1;
    process.stdout.write(
      `\r   Batch ${batchNum}/${totalBatches} (${Math.min(i + NEYNAR_BATCH_SIZE, wallets.length).toLocaleString()}/${wallets.length.toLocaleString()} wallets)...`
    );

    try {
      const result = await fetchNeynarBatch(batch);
      for (const [address, users] of Object.entries(result)) {
        if (users && users.length > 0) {
          // Use the first (primary) user for this address
          resolved.set(address.toLowerCase(), {
            user: users[0],
            wallet: address.toLowerCase(),
          });
        }
      }
    } catch (err) {
      console.warn(
        `\n   ⚠️  Batch ${batchNum} failed: ${(err as Error).message}`
      );
    }

    // Rate limit: small delay between batches
    if (i + NEYNAR_BATCH_SIZE < wallets.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    `\n\n   Resolved ${resolved.size.toLocaleString()} wallets with Farcaster profiles\n`
  );

  // ── Step 3: Create table and write results ──
  console.log("💾 Writing to wallet_farcaster_profiles table...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.wallet_farcaster_profiles (
      wallet TEXT PRIMARY KEY,
      fid INTEGER NOT NULL,
      username TEXT,
      display_name TEXT,
      pfp_url TEXT,
      follower_count INTEGER DEFAULT 0,
      following_count INTEGER DEFAULT 0,
      neynar_score NUMERIC,
      island_heat NUMERIC,
      token_breakdown JSONB,
      resolved_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`TRUNCATE ${sql(SCHEMA)}.wallet_farcaster_profiles`;

  // Build rows for insert
  const rows: {
    wallet: string;
    fid: number;
    username: string;
    display_name: string;
    pfp_url: string;
    follower_count: number;
    following_count: number;
    neynar_score: number;
    island_heat: number;
    token_breakdown: string;
  }[] = [];

  for (const [address, { user }] of resolved) {
    const heat = walletMap.get(address);
    if (!heat) continue;

    rows.push({
      wallet: address,
      fid: user.fid,
      username: user.username ?? "",
      display_name: user.display_name ?? "",
      pfp_url: user.pfp_url ?? "",
      follower_count: user.follower_count ?? 0,
      following_count: user.following_count ?? 0,
      neynar_score: user.neynar_user_score ?? 0,
      island_heat: heat.island_heat,
      token_breakdown: JSON.stringify(heat.token_breakdown),
    });
  }

  // Batch insert
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO ${sql(SCHEMA)}.wallet_farcaster_profiles ${sql(
        batch,
        "wallet",
        "fid",
        "username",
        "display_name",
        "pfp_url",
        "follower_count",
        "following_count",
        "neynar_score",
        "island_heat",
        "token_breakdown"
      )}
    `;
    process.stdout.write(
      `\r   Inserted ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()}/${rows.length.toLocaleString()} rows...`
    );
  }

  console.log(
    `\n\n   Wrote ${rows.length.toLocaleString()} Farcaster profiles to database\n`
  );

  // ── Step 4: Print summary ──
  // Sort by island_heat descending
  rows.sort((a, b) => b.island_heat - a.island_heat);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  TOP 30 WALLETS WITH FARCASTER PROFILES (by Island Heat)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const r of rows.slice(0, 30)) {
    const short = `${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)}`;
    const breakdown = JSON.parse(r.token_breakdown) as {
      token_name: string;
      heat_degrees: number;
    }[];
    const tokens = breakdown
      .sort((a, b) => b.heat_degrees - a.heat_degrees)
      .map((t) => `${t.token_name}:${t.heat_degrees.toFixed(1)}°`)
      .join(" ");
    console.log(
      `  ${r.island_heat.toFixed(1).padStart(7)}°  @${r.username.padEnd(20)} ${short}  fid:${r.fid}  followers:${r.follower_count.toLocaleString()}  ${tokens}`
    );
  }

  // Stats
  const withFarcaster = resolved.size;
  const withoutFarcaster = wallets.length - withFarcaster;
  const pct = ((withFarcaster / wallets.length) * 100).toFixed(1);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`  Total wallets:           ${wallets.length.toLocaleString()}`);
  console.log(
    `  With Farcaster profile:  ${withFarcaster.toLocaleString()} (${pct}%)`
  );
  console.log(`  Without profile:         ${withoutFarcaster.toLocaleString()}`);
  console.log();

  await sql.end();
  console.log("✅ Done. Farcaster profiles resolved.\n");
}

main().catch(console.error);
