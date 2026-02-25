import { Hono } from "hono";
import { CONFIG, db } from "../config";
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
      COALESCE(b.name, tr.name) AS name,
      COALESCE(b.symbol, tr.symbol) AS symbol,
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

  return c.json({ bungalows: rows });
});

export { homeTeamRoute };
