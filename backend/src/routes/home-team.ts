import { Hono } from "hono";
import { CONFIG, db } from "../config";
import { getHomeTeamToken, pickMetadataLabel } from "../services/homeTeam";
import type { AppEnv } from "../types";

interface HomeTeamBungalowRow {
  token_address: string;
  chain: string;
  name: string | null;
  symbol: string | null;
  holder_count: number;
  image_url: string | null;
  is_claimed: boolean | null;
  current_owner: string | null;
  description: string | null;
  market_cap: string | null;
  price_usd: string | null;
}

const homeTeamRoute = new Hono<AppEnv>();

homeTeamRoute.get("/home-team", async (c) => {
  const rows = await db<HomeTeamBungalowRow[]>`
    SELECT
      tr.token_address,
      tr.chain,
      CASE
        WHEN b.name IS NULL OR btrim(b.name) = '' OR lower(btrim(b.name)) IN ('unknown', '?', 'token', 'null')
          THEN tr.name
        ELSE b.name
      END AS name,
      CASE
        WHEN b.symbol IS NULL OR btrim(b.symbol) = '' OR lower(btrim(b.symbol)) IN ('unknown', '?', 'token', 'null')
          THEN tr.symbol
        ELSE b.symbol
      END AS symbol,
      tr.holder_count,
      b.image_url,
      b.is_claimed,
      b.current_owner,
      b.description,
      b.market_cap::text AS market_cap,
      b.price_usd::text AS price_usd
    FROM ${db(CONFIG.SCHEMA)}.token_registry tr
    LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalows b
      ON tr.token_address = b.token_address AND tr.chain = b.chain
    WHERE tr.is_home_team = TRUE
    ORDER BY tr.name ASC
  `;

  const bungalows = rows.map((row) => {
    const seeded = getHomeTeamToken(
      row.chain as "base" | "ethereum" | "solana",
      row.token_address,
    );

    return {
      ...row,
      name: pickMetadataLabel(row.name, row.symbol, seeded?.name),
      symbol: pickMetadataLabel(row.symbol, seeded?.symbol),
      image_url: row.image_url ?? seeded?.image_url ?? null,
    };
  });

  return c.json({ bungalows });
});

export { homeTeamRoute };
