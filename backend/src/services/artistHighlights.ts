import { CONFIG, db } from "../config";
import { ensureOnchainSchema } from "./onchain";

const HIGHLIGHT_WINDOW_MS = 60 * 60 * 1000;

let cachedWindowKey: number | null = null;
let cachedHighlights: ArtistHighlight[] = [];

export interface ArtistHighlight {
  artist_profile_id: number;
  artist_handle: string | null;
  score: number;
  rationale: string;
  metrics: {
    item_count: number;
    total_installs: number;
    distinct_bungalows: number;
    commissioned_items: number;
    approved_commissions: number;
    recent_items: number;
    recent_installs: number;
  };
  feature_item: {
    item_id: number;
    ipfs_uri: string;
    total_minted: string;
    price_usdc: string;
    commission_id: number | null;
    listed_at_unix: number;
  };
}

interface ArtistHighlightRow {
  artist_profile_id: number;
  artist_handle: string | null;
  item_count: string;
  total_installs: string;
  distinct_bungalows: string;
  commissioned_items: string;
  approved_commissions: string;
  recent_items: string;
  recent_installs: string;
  featured_item_id: number;
  featured_ipfs_uri: string;
  featured_total_minted: string;
  featured_price_usdc: string;
  featured_commission_id: number | null;
  featured_listed_at_unix: number;
}

function buildRationale(row: ArtistHighlightRow): string {
  const parts: string[] = [];

  const approved = Number(row.approved_commissions ?? 0);
  if (approved > 0) {
    parts.push(`${approved} approved commission${approved === 1 ? "" : "s"}`);
  }

  const installs = Number(row.total_installs ?? 0);
  if (installs > 0) {
    parts.push(`${installs} installs`);
  }

  const bungalows = Number(row.distinct_bungalows ?? 0);
  if (bungalows > 0) {
    parts.push(`spread across ${bungalows} bungalow${bungalows === 1 ? "" : "s"}`);
  }

  const recent = Number(row.recent_items ?? 0);
  if (recent > 0) {
    parts.push(`${recent} new drop${recent === 1 ? "" : "s"} this week`);
  }

  return parts.slice(0, 3).join(" • ") || "Consistent creative output on the island";
}

function computeScore(row: ArtistHighlightRow): number {
  const itemCount = Number(row.item_count ?? 0);
  const installs = Number(row.total_installs ?? 0);
  const distinctBungalows = Number(row.distinct_bungalows ?? 0);
  const commissionedItems = Number(row.commissioned_items ?? 0);
  const approvedCommissions = Number(row.approved_commissions ?? 0);
  const recentItems = Number(row.recent_items ?? 0);
  const recentInstalls = Number(row.recent_installs ?? 0);

  return Number(
    (
      installs * 4 +
      distinctBungalows * 7 +
      itemCount * 3 +
      commissionedItems * 9 +
      approvedCommissions * 11 +
      recentItems * 5 +
      recentInstalls * 6
    ).toFixed(2),
  );
}

export async function getHighlightedArtists(limit = 10): Promise<ArtistHighlight[]> {
  await ensureOnchainSchema();

  const windowKey = Math.floor(Date.now() / HIGHLIGHT_WINDOW_MS);
  if (cachedWindowKey === windowKey && cachedHighlights.length >= limit) {
    return cachedHighlights.slice(0, limit);
  }

  const sevenDaysAgoUnix = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const rows = await db.unsafe<ArtistHighlightRow[]>(
    `
      WITH item_metrics AS (
        SELECT
          i.creator_profile_id::int AS artist_profile_id,
          p.x_handle AS artist_handle,
          COUNT(*)::text AS item_count,
          COALESCE(SUM(i.total_minted)::numeric, 0)::text AS total_installs,
          COUNT(DISTINCT inst.bungalow_id)::text AS distinct_bungalows,
          COUNT(*) FILTER (WHERE i.commission_id IS NOT NULL)::text AS commissioned_items,
          COUNT(*) FILTER (WHERE i.listed_at_unix >= $1)::text AS recent_items,
          COALESCE(
            SUM(i.total_minted) FILTER (WHERE i.listed_at_unix >= $1)::numeric,
            0
          )::text AS recent_installs
        FROM "${CONFIG.SCHEMA}".onchain_bodega_items i
        LEFT JOIN "${CONFIG.SCHEMA}".onchain_profiles p
          ON p.profile_id = i.creator_profile_id
        LEFT JOIN "${CONFIG.SCHEMA}".onchain_bungalow_installs inst
          ON inst.item_id = i.item_id
        WHERE i.active = TRUE
        GROUP BY i.creator_profile_id, p.x_handle
      ),
      commission_metrics AS (
        SELECT
          selected_artist_profile_id::int AS artist_profile_id,
          COUNT(*) FILTER (WHERE status = 'APPROVED')::text AS approved_commissions
        FROM "${CONFIG.SCHEMA}".onchain_commissions
        WHERE selected_artist_profile_id IS NOT NULL
        GROUP BY selected_artist_profile_id
      ),
      ranked_items AS (
        SELECT
          i.creator_profile_id::int AS artist_profile_id,
          i.item_id::int AS featured_item_id,
          i.ipfs_uri AS featured_ipfs_uri,
          i.total_minted::text AS featured_total_minted,
          i.price_usdc::text AS featured_price_usdc,
          i.commission_id::int AS featured_commission_id,
          i.listed_at_unix::int AS featured_listed_at_unix,
          ROW_NUMBER() OVER (
            PARTITION BY i.creator_profile_id
            ORDER BY
              CASE WHEN i.commission_id IS NULL THEN 0 ELSE 1 END DESC,
              i.total_minted DESC,
              i.listed_at_unix DESC,
              i.item_id DESC
          ) AS rank
        FROM "${CONFIG.SCHEMA}".onchain_bodega_items i
        WHERE i.active = TRUE
      )
      SELECT
        im.artist_profile_id,
        im.artist_handle,
        im.item_count,
        im.total_installs,
        im.distinct_bungalows,
        im.commissioned_items,
        COALESCE(cm.approved_commissions, '0') AS approved_commissions,
        im.recent_items,
        im.recent_installs,
        ri.featured_item_id,
        ri.featured_ipfs_uri,
        ri.featured_total_minted,
        ri.featured_price_usdc,
        ri.featured_commission_id,
        ri.featured_listed_at_unix
      FROM item_metrics im
      INNER JOIN ranked_items ri
        ON ri.artist_profile_id = im.artist_profile_id
       AND ri.rank = 1
      LEFT JOIN commission_metrics cm
        ON cm.artist_profile_id = im.artist_profile_id
      ORDER BY im.artist_profile_id ASC
    `,
    [sevenDaysAgoUnix],
  );

  cachedWindowKey = windowKey;
  cachedHighlights = rows
    .map((row) => ({
      artist_profile_id: row.artist_profile_id,
      artist_handle: row.artist_handle,
      score: computeScore(row),
      rationale: buildRationale(row),
      metrics: {
        item_count: Number(row.item_count ?? 0),
        total_installs: Number(row.total_installs ?? 0),
        distinct_bungalows: Number(row.distinct_bungalows ?? 0),
        commissioned_items: Number(row.commissioned_items ?? 0),
        approved_commissions: Number(row.approved_commissions ?? 0),
        recent_items: Number(row.recent_items ?? 0),
        recent_installs: Number(row.recent_installs ?? 0),
      },
      feature_item: {
        item_id: row.featured_item_id,
        ipfs_uri: row.featured_ipfs_uri,
        total_minted: row.featured_total_minted,
        price_usdc: row.featured_price_usdc,
        commission_id: row.featured_commission_id,
        listed_at_unix: row.featured_listed_at_unix,
      },
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return cachedHighlights;
}
