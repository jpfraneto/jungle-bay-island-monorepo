/**
 * build-personas.ts — Island Persona Builder
 *
 * On Jungle Bay Island, a person is not a wallet. A person is a soul —
 * a Farcaster identity (FID) that may hold many wallets, each carrying
 * different bungalow tokens. This script weaves those scattered wallets
 * into a single Island Persona.
 *
 * What it does:
 *   1. Reads all wallet-token heat scores from heat_precalculated
 *   2. Reads all Farcaster-linked wallets from wallet_farcaster_profiles
 *   3. Groups wallets by FID (Farcaster ID) — one person, many wallets
 *   4. For each FID, merges heat across all their wallets:
 *      - Same token held in multiple wallets? Heat gets summed.
 *      - Different tokens across wallets? All counted toward Island Heat.
 *   5. Produces a unified Island Persona per FID with:
 *      - Combined Island Heat (sum of all token heats across all wallets)
 *      - Per-token breakdown (merged across wallets)
 *      - Farcaster profile (username, pfp, followers, etc.)
 *      - List of all associated wallets
 *   6. Writes to "prod-v11".fid_island_profiles
 *
 * The result is the true leaderboard — humans, not wallets.
 * A person like @seacasa with heat spread across two wallets
 * finally appears as the Elder they truly are.
 *
 * Run:
 *   bun run --env-file .env.local scripts/build-personas.ts
 *
 * Requires:
 *   DATABASE_URL — Postgres connection string
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const SCHEMA = "prod-v11";

// ─── Types ─────────────────────────────────────────────────────
type TokenHeat = { token: string; token_name: string; heat_degrees: number };

type WalletHeatRow = {
  wallet: string;
  token: string;
  token_name: string;
  heat_degrees: number;
  island_heat: number;
};

type FarcasterRow = {
  wallet: string;
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
  neynar_score: number;
};

type Persona = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
  neynar_score: number;
  island_heat: number;
  token_breakdown: { token: string; token_name: string; heat_degrees: number }[];
  wallets: string[];
  wallet_count: number;
};

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const sql = postgres(DATABASE_URL);
  const start = Date.now();

  console.log("\n\x1b[32m" + `
   ╔══════════════════════════════════════════════════╗
   ║     🌴 JUNGLE BAY ISLAND — PERSONA BUILDER 🌴    ║
   ╚══════════════════════════════════════════════════╝
  ` + "\x1b[0m");

  console.log(`   🗺️  Schema: ${SCHEMA}`);
  console.log(`   🕐 ${new Date().toISOString()}\n`);

  // ── Step 1: Read all wallet-token heat scores ──
  console.log("🌿 Step 1: Reading heat scores from the island's memory...\n");

  const heatRows = await sql<WalletHeatRow[]>`
    SELECT wallet, token, token_name, heat_degrees, island_heat
    FROM ${sql(SCHEMA)}.heat_precalculated
  `;

  // Build map: wallet -> array of token heats
  const walletHeatMap = new Map<string, TokenHeat[]>();
  for (const row of heatRows) {
    const w = row.wallet;
    if (!walletHeatMap.has(w)) walletHeatMap.set(w, []);
    walletHeatMap.get(w)!.push({
      token: row.token,
      token_name: row.token_name,
      heat_degrees: Number(row.heat_degrees),
    });
  }

  const uniqueWallets = walletHeatMap.size;
  console.log(`   🍃 ${uniqueWallets.toLocaleString()} wallets carrying heat across the island\n`);

  // ── Step 2: Read Farcaster profiles ──
  console.log("🦜 Step 2: Calling the parrots... fetching Farcaster identities...\n");

  const fcRows = await sql<FarcasterRow[]>`
    SELECT wallet, fid, username, display_name, pfp_url,
           follower_count, following_count, neynar_score
    FROM ${sql(SCHEMA)}.wallet_farcaster_profiles
  `;

  // Build map: wallet -> farcaster profile
  const walletToFc = new Map<string, FarcasterRow>();
  for (const row of fcRows) {
    walletToFc.set(row.wallet, row);
  }

  console.log(`   🦜 ${walletToFc.size.toLocaleString()} wallets linked to Farcaster souls\n`);

  // ── Step 3: Group wallets by FID ──
  console.log("🔥 Step 3: Weaving wallets into personas... one soul, many wallets...\n");

  // Group: FID -> { profile, wallets[] }
  const fidGroups = new Map<number, { profile: FarcasterRow; wallets: string[] }>();

  for (const [wallet, fc] of walletToFc) {
    // Only include wallets that actually have heat
    if (!walletHeatMap.has(wallet)) continue;

    if (!fidGroups.has(fc.fid)) {
      fidGroups.set(fc.fid, { profile: fc, wallets: [] });
    }
    fidGroups.get(fc.fid)!.wallets.push(wallet);
  }

  const multiWalletFids = [...fidGroups.values()].filter((g) => g.wallets.length > 1).length;
  console.log(`   🌺 ${fidGroups.size.toLocaleString()} unique Farcaster identities found`);
  console.log(`   🐒 ${multiWalletFids.toLocaleString()} of them hold heat across multiple wallets\n`);

  // ── Step 4: Merge heat per FID ──
  console.log("🌋 Step 4: Merging the heat... forging Island Personas...\n");

  const personas: Persona[] = [];

  for (const [fid, group] of fidGroups) {
    const { profile, wallets } = group;

    // Merge token heat across all wallets for this FID
    // Key: token address -> accumulated heat
    const mergedTokens = new Map<string, { token: string; token_name: string; heat_degrees: number }>();

    for (const wallet of wallets) {
      const tokenHeats = walletHeatMap.get(wallet) ?? [];
      for (const th of tokenHeats) {
        if (mergedTokens.has(th.token)) {
          mergedTokens.get(th.token)!.heat_degrees += th.heat_degrees;
        } else {
          mergedTokens.set(th.token, { ...th });
        }
      }
    }

    // Calculate total island heat from merged tokens
    const tokenBreakdown = [...mergedTokens.values()]
      .map((t) => ({ ...t, heat_degrees: Math.round(t.heat_degrees * 100) / 100 }))
      .sort((a, b) => b.heat_degrees - a.heat_degrees);

    const islandHeat = Math.round(
      tokenBreakdown.reduce((sum, t) => sum + t.heat_degrees, 0) * 100
    ) / 100;

    personas.push({
      fid,
      username: profile.username,
      display_name: profile.display_name,
      pfp_url: profile.pfp_url,
      follower_count: Number(profile.follower_count),
      following_count: Number(profile.following_count),
      neynar_score: Number(profile.neynar_score),
      island_heat: islandHeat,
      token_breakdown: tokenBreakdown,
      wallets: wallets.sort(),
      wallet_count: wallets.length,
    });
  }

  // Sort by Island Heat descending
  personas.sort((a, b) => b.island_heat - a.island_heat);

  console.log(`   🌋 ${personas.length.toLocaleString()} Island Personas forged\n`);

  // ── Step 5: Write to database ──
  console.log("🏝️  Step 5: Inscribing personas into the island's stone tablets...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCHEMA)}.fid_island_profiles (
      fid INTEGER PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      pfp_url TEXT,
      follower_count INTEGER DEFAULT 0,
      following_count INTEGER DEFAULT 0,
      neynar_score NUMERIC,
      island_heat NUMERIC NOT NULL,
      token_breakdown JSONB NOT NULL,
      wallets JSONB NOT NULL,
      wallet_count INTEGER NOT NULL,
      tier TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`TRUNCATE ${sql(SCHEMA)}.fid_island_profiles`;

  // Assign tiers
  function getTier(heat: number): string {
    if (heat >= 250) return "Elder";
    if (heat >= 150) return "Builder";
    if (heat >= 80) return "Resident";
    if (heat >= 30) return "Observer";
    return "Drifter";
  }

  const rows = personas.map((p) => ({
    fid: p.fid,
    username: p.username,
    display_name: p.display_name,
    pfp_url: p.pfp_url,
    follower_count: p.follower_count,
    following_count: p.following_count,
    neynar_score: p.neynar_score,
    island_heat: p.island_heat,
    token_breakdown: JSON.stringify(p.token_breakdown),
    wallets: JSON.stringify(p.wallets),
    wallet_count: p.wallet_count,
    tier: getTier(p.island_heat),
  }));

  const BATCH_SIZE = 500;
  const writeStart = Date.now();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO ${sql(SCHEMA)}.fid_island_profiles ${sql(
        batch,
        "fid", "username", "display_name", "pfp_url",
        "follower_count", "following_count", "neynar_score",
        "island_heat", "token_breakdown", "wallets", "wallet_count", "tier"
      )}
    `;
    process.stdout.write(`\r   🪨 Inscribed ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()}/${rows.length.toLocaleString()} personas...`);
  }

  const writeElapsed = ((Date.now() - writeStart) / 1000).toFixed(1);
  console.log(`\r   🪨 Inscribed ${rows.length.toLocaleString()} personas in ${writeElapsed}s${"".padEnd(20)}\n`);

  // ── Step 6: Print the sacred leaderboard ──
  console.log("🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴");
  console.log("  THE ISLAND KNOWS ITS PEOPLE — TOP 30 PERSONAS");
  console.log("🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴🌴\n");

  for (const p of personas.slice(0, 30)) {
    const tierEmoji =
      p.island_heat >= 250 ? "👑" :
      p.island_heat >= 150 ? "🔨" :
      p.island_heat >= 80  ? "🏠" :
      p.island_heat >= 30  ? "👁️" : "🌊";

    const tokens = p.token_breakdown
      .map((t) => `${t.token_name}:${t.heat_degrees.toFixed(1)}°`)
      .join(" ");

    const walletLabel = p.wallet_count > 1 ? ` (${p.wallet_count} wallets)` : "";

    console.log(
      `  ${tierEmoji} ${p.island_heat.toFixed(1).padStart(7)}°  @${p.username.padEnd(22)} ${tokens}${walletLabel}`
    );
  }

  // ── Step 7: Tier census ──
  const elders    = personas.filter((p) => p.island_heat >= 250);
  const builders  = personas.filter((p) => p.island_heat >= 150 && p.island_heat < 250);
  const residents = personas.filter((p) => p.island_heat >= 80  && p.island_heat < 150);
  const observers = personas.filter((p) => p.island_heat >= 30  && p.island_heat < 80);
  const drifters  = personas.filter((p) => p.island_heat < 30);

  console.log("\n🏝️  ISLAND CENSUS\n");
  console.log(`  👑 Elders    (250°+):  ${elders.length.toLocaleString()}`);
  if (elders.length > 0) {
    for (const e of elders.slice(0, 5)) {
      console.log(`     └─ @${e.username} — ${e.island_heat.toFixed(1)}°`);
    }
  }
  console.log(`  🔨 Builders  (150°+):  ${builders.length.toLocaleString()}`);
  if (builders.length > 0) {
    for (const b of builders.slice(0, 5)) {
      console.log(`     └─ @${b.username} — ${b.island_heat.toFixed(1)}°`);
    }
  }
  console.log(`  🏠 Residents (80°+):   ${residents.length.toLocaleString()}`);
  console.log(`  👁️  Observers (30°+):   ${observers.length.toLocaleString()}`);
  console.log(`  🌊 Drifters  (<30°):   ${drifters.length.toLocaleString()}`);
  console.log(`\n  🌺 Total personas:     ${personas.length.toLocaleString()}`);

  // Multi-wallet stats
  const multiWallet = personas.filter((p) => p.wallet_count > 1);
  const maxWallets = Math.max(...personas.map((p) => p.wallet_count));
  const topMulti = personas.filter((p) => p.wallet_count === maxWallets)[0];

  console.log(`\n  🐒 Multi-wallet souls: ${multiWallet.length.toLocaleString()}`);
  if (topMulti) {
    console.log(`  🐒 Most wallets:       @${topMulti.username} with ${topMulti.wallet_count} wallets`);
  }

  // Heat gained from merging
  console.log("\n🔥 PERSONAS MOST CHANGED BY WALLET MERGING:\n");

  // Compare merged heat vs their highest single-wallet heat
  const mergeGains: { username: string; merged: number; bestSingle: number; gain: number }[] = [];
  for (const p of personas) {
    if (p.wallet_count <= 1) continue;
    // Find the best single wallet heat for this persona
    let bestSingle = 0;
    for (const w of p.wallets) {
      const heats = walletHeatMap.get(w) ?? [];
      const walletTotal = heats.reduce((s, h) => s + h.heat_degrees, 0);
      if (walletTotal > bestSingle) bestSingle = walletTotal;
    }
    const gain = p.island_heat - bestSingle;
    if (gain > 1) {
      mergeGains.push({ username: p.username, merged: p.island_heat, bestSingle, gain });
    }
  }

  mergeGains.sort((a, b) => b.gain - a.gain);
  for (const g of mergeGains.slice(0, 10)) {
    console.log(`  🌿 @${g.username.padEnd(22)} ${g.bestSingle.toFixed(1)}° → ${g.merged.toFixed(1)}°  (+${g.gain.toFixed(1)}° from merging wallets)`);
  }

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  🕐 Total time: ${totalElapsed}s`);

  await sql.end();
  console.log("\n🌴 The island has spoken. Its people are known.\n");
}

main().catch((err) => {
  console.error("🌑 The island trembles:", err);
  process.exit(1);
});
