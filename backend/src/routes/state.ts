import { Hono } from "hono";
import { CONFIG, db } from "../config";
import { optionalWalletContext } from "../middleware/auth";
import { listOnchainInteractions } from "../services/interactionLedger";
import {
  getCommissionDetail,
  getCommissionList,
  getDailyClaimState,
  getOnchainMe,
  listBodegaItems,
  resolveBungalowByAsset,
  resolveSessionIdentity,
  type SessionIdentity,
} from "../services/onchain";
import { getHighlightedArtists } from "../services/artistHighlights";
import { loadHomeTeamBungalows } from "./home-team";
import type { AppEnv } from "../types";

const stateRoute = new Hono<AppEnv>();

stateRoute.use("/state/*", optionalWalletContext);

function asOptionalInt(value: string | null | undefined): number | null {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getOptionalSession(c: any): Promise<SessionIdentity | null> {
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  if (!privyUserId) {
    return null;
  }
  return await resolveSessionIdentity({ privyUserId, claims });
}

async function getOptionalMe(c: any, session: SessionIdentity | null) {
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  if (!privyUserId || !session) {
    return null;
  }
  return await getOnchainMe({ privyUserId, claims });
}

stateRoute.get("/state/me", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const selectedWallet =
    (c.get("walletAddress") as string | undefined) ??
    session?.authorizedWallets[0] ??
    null;

  const claim =
    session && selectedWallet
      ? await getDailyClaimState({ wallet: selectedWallet, session })
      : null;

  const recentTxs = session?.profileId
    ? await listOnchainInteractions({ profileId: session.profileId, limit: 12 })
    : [];

  return c.json({
    authenticated: Boolean(session),
    me,
    claim,
    recent_txs: recentTxs,
  });
});

stateRoute.get("/state/island", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const bungalows = await loadHomeTeamBungalows();

  return c.json({
    me,
    bungalows,
    stats: {
      bungalow_count: bungalows.length,
      claimed_count: bungalows.filter((bungalow) => Boolean(bungalow.is_claimed)).length,
    },
    updated_at_unix: Math.floor(Date.now() / 1000),
  });
});

stateRoute.get("/state/bodega", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const limit = asOptionalInt(c.req.query("limit")) ?? 48;

  const [items, highlightedArtists] = await Promise.all([
    listBodegaItems({ limit }),
    getHighlightedArtists(10),
  ]);

  return c.json({
    me,
    items,
    highlighted_artists: highlightedArtists,
    updated_at_unix: Math.floor(Date.now() / 1000),
  });
});

stateRoute.get("/state/bungalow/:chain/:tokenAddress", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const chain = c.req.param("chain");
  const tokenAddress = c.req.param("tokenAddress");
  const page = await resolveBungalowByAsset({ chain, tokenAddress, session });

  const leaderboardAsset = page.seed_asset ?? {
    chain,
    token_address: tokenAddress,
  };

  const [heatLeaderboard, bondHolders, recentTxs] = await Promise.all([
    db.unsafe<Array<{
      wallet: string;
      handle: string | null;
      heat_score: string;
      island_heat: string | null;
      avatar_url: string | null;
    }>>(
      `
        SELECT
          thh.wallet,
          wfp.username AS handle,
          thh.heat_degrees::text AS heat_score,
          wfp.island_heat::text AS island_heat,
          wfp.pfp_url AS avatar_url
        FROM "${CONFIG.SCHEMA}".token_holder_heat thh
        LEFT JOIN "${CONFIG.SCHEMA}".wallet_farcaster_profiles wfp
          ON LOWER(wfp.wallet) = LOWER(thh.wallet)
        WHERE thh.chain = $1
          AND LOWER(thh.token_address) = LOWER($2)
        ORDER BY thh.heat_degrees DESC, thh.wallet ASC
        LIMIT 10
      `,
      [leaderboardAsset.chain, leaderboardAsset.token_address],
    ),
    page.bungalow_id
      ? db.unsafe<Array<{
          profile_id: number;
          handle: string | null;
          heat_score: string;
          main_wallet: string | null;
        }>>(
          `
            SELECT
              h.profile_id::int AS profile_id,
              p.x_handle AS handle,
              h.heat_score::text AS heat_score,
              p.main_wallet
            FROM "${CONFIG.SCHEMA}".onchain_profile_bungalow_heat h
            LEFT JOIN "${CONFIG.SCHEMA}".onchain_profiles p
              ON p.profile_id = h.profile_id
            WHERE h.bungalow_id = $1
              AND h.bond_activated = TRUE
            ORDER BY h.heat_score DESC, h.profile_id ASC
            LIMIT 24
          `,
          [page.bungalow_id],
        )
      : Promise.resolve([]),
    page.bungalow_id
      ? listOnchainInteractions({ bungalowId: page.bungalow_id, limit: 12 })
      : Promise.resolve([]),
  ]);

  return c.json({
    me,
    page,
    heat_leaderboard: heatLeaderboard,
    bond_holders: bondHolders,
    recent_txs: recentTxs,
    stats: {
      asset_count: page.assets.length,
      install_count: page.installs.length,
      active_commission_count: page.commissions.filter((commission) => commission.status === "OPEN").length,
    },
  });
});

stateRoute.get("/state/commissions", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const scope = c.req.query("scope");
  const limit = asOptionalInt(c.req.query("limit")) ?? 48;

  return c.json({
    me,
    ...(await getCommissionList({ scope, session, limit })),
  });
});

stateRoute.get("/state/commissions/:commissionId", async (c) => {
  const session = await getOptionalSession(c);
  const me = await getOptionalMe(c, session);
  const commissionId = asOptionalInt(c.req.param("commissionId"));

  if (!commissionId) {
    return c.json({ error: "invalid commission id" }, 400);
  }

  return c.json({
    me,
    ...(await getCommissionDetail({ commissionId, session })),
  });
});

export default stateRoute;
