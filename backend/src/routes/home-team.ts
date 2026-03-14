import { Hono } from "hono";
import { CONFIG, db, type SupportedChain } from "../config";
import { getCanonicalProjectContext } from "../services/canonicalProjects";
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

export async function loadHomeTeamBungalows() {
  const rows = await db<HomeTeamBungalowRow[]>`
    SELECT
      b.token_address,
      b.chain,
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
      COALESCE(tr.holder_count, b.holder_count, 0) AS holder_count,
      b.image_url,
      b.is_claimed,
      b.current_owner,
      b.description,
      b.market_cap::text AS market_cap,
      b.price_usd::text AS price_usd
    FROM ${db(CONFIG.SCHEMA)}.bungalows b
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = b.token_address AND tr.chain = b.chain
    ORDER BY COALESCE(tr.holder_count, b.holder_count, 0) DESC, COALESCE(b.name, tr.name, b.symbol, tr.symbol, b.token_address) ASC
  `;

  const rawBungalows = rows.map((row) => {
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

  const grouped = new Map<string, typeof rawBungalows>();

  for (const bungalow of rawBungalows) {
    const context = await getCanonicalProjectContext(
      bungalow.chain as SupportedChain,
      bungalow.token_address,
    );
    const key =
      context.project?.id ?? `${bungalow.chain}:${bungalow.token_address}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(bungalow);
    } else {
      grouped.set(key, [bungalow]);
    }
  }

  const bungalows = [...grouped.values()]
    .map(async (group) => {
      const context = await getCanonicalProjectContext(
        group[0].chain as SupportedChain,
        group[0].token_address,
      );
      const primary =
        group.find(
          (item) =>
            item.chain === context.primaryDeployment.chain &&
            item.token_address === context.primaryDeployment.token_address,
        ) ?? group[0];

      return {
        ...primary,
        canonical_slug: context.project?.slug ?? null,
        name: context.project?.name ?? primary.name,
        symbol: context.project?.symbol ?? primary.symbol,
        holder_count: group.reduce(
          (sum, item) => sum + Math.max(0, item.holder_count ?? 0),
          0,
        ),
        image_url:
          primary.image_url ?? group.find((item) => item.image_url)?.image_url ?? null,
        is_claimed: group.some((item) => Boolean(item.is_claimed)),
        current_owner:
          primary.current_owner ??
          group.find((item) => item.current_owner)?.current_owner ??
          null,
        description:
          primary.description ??
          group.find((item) => item.description)?.description ??
          null,
      };
    })
    ;

  const resolvedBungalows = await Promise.all(bungalows);

  const sortedBungalows = resolvedBungalows
    .sort((a, b) => {
      const holderDelta = (b.holder_count ?? 0) - (a.holder_count ?? 0);
      if (holderDelta !== 0) return holderDelta;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

  return sortedBungalows;
}

const homeTeamRoute = new Hono<AppEnv>();

homeTeamRoute.get("/home-team", async (c) => {
  return c.json({ bungalows: await loadHomeTeamBungalows() });
});

export { homeTeamRoute };
