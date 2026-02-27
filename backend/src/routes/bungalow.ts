import { Hono } from "hono";
import { CONFIG, normalizeAddress, toSupportedChain } from "../config";
import {
  createBulletinPost,
  getBulletinPosts,
  getBungalow,
  getBungalowOwnerRecord,
  getTokenHeatDistribution,
  getTokenHolders,
  getTokenRegistry,
  getViewerProfile,
  getWalletTokenHeat,
  updateBungalowCuration,
} from "../db/queries";
import { optionalWalletContext, requireWalletAuth } from "../middleware/auth";
import { clearCache, getCached, setCached } from "../services/cache";
import { ApiError } from "../services/errors";
import { logDebug, logInfo } from "../services/logger";
import { resolveTokenMetadata } from "../services/tokenMetadata";
import type { AppEnv } from "../types";

const bungalowRoute = new Hono<AppEnv>();

bungalowRoute.use("/bungalow/*", optionalWalletContext);

function calculateTopHeatStats(values: number[]): {
  sample_size: number;
  top_50_average: number | null;
  top_50_stddev: number | null;
} {
  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .slice(0, 50);

  const sampleSize = normalized.length;
  if (sampleSize === 0) {
    return {
      sample_size: 0,
      top_50_average: null,
      top_50_stddev: null,
    };
  }

  const mean = normalized.reduce((sum, value) => sum + value, 0) / sampleSize;
  const variance =
    normalized.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    sampleSize;
  const stddev = Math.sqrt(Math.max(variance, 0));

  return {
    sample_size: sampleSize,
    top_50_average: Number(mean.toFixed(4)),
    top_50_stddev: Number(stddev.toFixed(4)),
  };
}

bungalowRoute.get("/bungalow/:chain/:ca", async (c) => {
  const requestId = c.get("requestId") ?? "unknown";
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const viewerWallet = c.get("walletAddress") ?? null;
  logInfo(
    "BUNGALOW REQ",
    `request_id=${requestId} chain=${chain} token=${tokenAddress} viewer=${viewerWallet ?? "anon"}`,
  );

  const cacheKey = `bungalow:${chain}:${tokenAddress}:${viewerWallet ?? "anon"}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) {
    logDebug("CACHE HIT", `request_id=${requestId} bungalow key=${cacheKey}`);
    return c.json(cached);
  }

  const bungalow = await getBungalow(tokenAddress, chain);

  if (!bungalow) {
    const fallback = await resolveTokenMetadata(tokenAddress, chain);
    const notFound = {
      token_address: tokenAddress,
      chain,
      name: fallback.name,
      symbol: fallback.symbol,
      exists: false,
      is_claimed: false,
      is_verified: false,
      description: fallback.description,
      origin_story: null,
      image_url: fallback.image_url,
      market_data: fallback.market_data,
      links: {
        x: fallback.links.x,
        farcaster: fallback.links.farcaster,
        telegram: fallback.links.telegram,
        website: fallback.links.website,
        dexscreener: fallback.links.dexscreener,
      },
    };
    setCached(cacheKey, notFound, CONFIG.BUNGALOW_CACHE_MS);
    return c.json(notFound);
  }

  const hasMarketData = bungalow.price_usd || bungalow.market_cap;
  const viewerIsOwner = Boolean(
    viewerWallet &&
    bungalow.current_owner &&
    viewerWallet.toLowerCase() === bungalow.current_owner.toLowerCase(),
  );

  const fallbackMetadataPromise =
    !bungalow.image_url || !bungalow.name || !bungalow.symbol
      ? resolveTokenMetadata(tokenAddress, chain).catch(() => null)
      : Promise.resolve(null);

  // Fetch holders and heat distribution
  const [holdersResult, heatDistribution, tokenRegistry, fallbackMetadata] = await Promise.all([
    getTokenHolders(tokenAddress, 50, 0),
    getTokenHeatDistribution(tokenAddress),
    getTokenRegistry(tokenAddress, chain),
    fallbackMetadataPromise,
  ]);

  const decimals = tokenRegistry?.decimals ?? null;
  const isNft = decimals === 0;
  const topHeatStats = calculateTopHeatStats(
    holdersResult.holders.map((holder) => Number(holder.heat_degrees)),
  );

  const response: Record<string, unknown> = {
    token_address: tokenAddress,
    chain,
    name: bungalow.name ?? fallbackMetadata?.name ?? null,
    symbol: bungalow.symbol ?? fallbackMetadata?.symbol ?? null,
    decimals,
    is_nft: isNft,
    exists: true,
    is_claimed: bungalow.is_claimed ?? false,
    is_verified: bungalow.is_verified ?? false,
    current_owner: bungalow.current_owner ?? null,
    description: bungalow.description ?? fallbackMetadata?.description ?? null,
    origin_story: bungalow.origin_story ?? null,
    image_url: bungalow.image_url ?? fallbackMetadata?.image_url ?? null,
    holder_count: bungalow.holder_count ?? 0,
    total_supply: bungalow.total_supply ?? null,
    market_data: hasMarketData
      ? {
          price_usd: bungalow.price_usd ? Number(bungalow.price_usd) : null,
          market_cap: bungalow.market_cap ? Number(bungalow.market_cap) : null,
          volume_24h: bungalow.volume_24h ? Number(bungalow.volume_24h) : null,
          liquidity_usd: bungalow.liquidity_usd ? Number(bungalow.liquidity_usd) : null,
          updated_at: bungalow.metadata_updated_at ?? null,
        }
      : fallbackMetadata?.market_data ?? null,
    links: {
      x: bungalow.link_x ?? fallbackMetadata?.links.x ?? null,
      farcaster: bungalow.link_farcaster ?? fallbackMetadata?.links.farcaster ?? null,
      telegram: bungalow.link_telegram ?? fallbackMetadata?.links.telegram ?? null,
      website: bungalow.link_website ?? fallbackMetadata?.links.website ?? null,
      dexscreener: bungalow.link_dexscreener ?? fallbackMetadata?.links.dexscreener ?? null,
    },
    heat_stats: topHeatStats,
    holders: holdersResult.holders.map((h, idx) => ({
      rank: idx + 1,
      wallet: h.wallet,
      heat_degrees: Number(h.heat_degrees),
      farcaster: h.fid ? { fid: h.fid, username: h.username, pfp_url: h.pfp_url } : null,
    })),
    heat_distribution: heatDistribution,
  };

  if (viewerWallet) {
    const [viewerProfile, walletHeat] = await Promise.all([
      getViewerProfile(viewerWallet),
      getWalletTokenHeat(tokenAddress, viewerWallet),
    ]);

    response.viewer_context = {
      wallet: viewerWallet,
      is_owner: viewerIsOwner,
      holds_token: walletHeat !== null,
      token_heat_degrees: walletHeat ?? 0,
      island_heat: viewerProfile?.islandHeat ?? 0,
      tier: viewerProfile?.tier ?? 'drifter',
    };
  }

  setCached(cacheKey, response, CONFIG.BUNGALOW_CACHE_MS);
  logInfo(
    "BUNGALOW RESP",
    `request_id=${requestId} token=${tokenAddress} chain=${chain} exists=true claimed=${bungalow.is_claimed}`,
  );
  return c.json(response);
});

bungalowRoute.put("/bungalow/:chain/:ca/curate", requireWalletAuth, async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  const wallet = c.get("walletAddress");

  if (!tokenAddress || !wallet) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const ownerRecord = await getBungalowOwnerRecord(tokenAddress, chain);
  if (!ownerRecord) {
    throw new ApiError(404, "bungalow_not_found", "Bungalow not found");
  }

  const owner = ownerRecord.current_owner?.toLowerCase() ?? null;
  const admin = ownerRecord.verified_admin?.toLowerCase() ?? null;
  const caller = wallet.toLowerCase();

  if ((owner || admin) && owner !== caller && admin !== caller) {
    throw new ApiError(403, "not_bungalow_owner", "Only the bungalow owner can curate this page");
  }

  const body = await c.req.json<Record<string, unknown>>();

  const fields: Record<string, string | null> = {};

  if (typeof body.description === "string") {
    if (body.description.length > 500) {
      throw new ApiError(400, "description_too_long", "Description must be 500 characters or less");
    }
    fields.description = body.description.trim() || null;
  }

  if (typeof body.origin_story === "string") {
    if (body.origin_story.length > 2000) {
      throw new ApiError(400, "origin_story_too_long", "Origin story must be 2000 characters or less");
    }
    fields.origin_story = body.origin_story.trim() || null;
  }

  for (const linkKey of ["link_x", "link_farcaster", "link_telegram", "link_website"] as const) {
    const val = body[linkKey];
    if (val === null || val === "") {
      fields[linkKey] = null;
    } else if (typeof val === "string") {
      try {
        new URL(val);
        fields[linkKey] = val;
      } catch {
        throw new ApiError(400, "invalid_link", `${linkKey} is not a valid URL`);
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    throw new ApiError(400, "no_fields", "No valid fields to update");
  }

  await updateBungalowCuration(tokenAddress, chain, fields);
  clearCache(`bungalow:${chain}:${tokenAddress}`);
  logInfo("BUNGALOW CURATE", `wallet=${wallet} token=${tokenAddress} chain=${chain} fields=${Object.keys(fields).join(",")}`);

  return c.json({ ok: true });
});

bungalowRoute.get("/bungalow/:chain/:ca/bulletin", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const result = await getBulletinPosts(tokenAddress, limit, offset);
  return c.json({
    posts: result.posts.map((p) => ({
      id: p.id,
      wallet: p.wallet,
      content: p.content,
      image_url: p.image_url,
      created_at: p.created_at,
      poster_username: (p as any).poster_username ?? null,
      poster_pfp: (p as any).poster_pfp ?? null,
    })),
    total: result.total,
  });
});

bungalowRoute.post("/bungalow/:chain/:ca/bulletin", requireWalletAuth, async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  const wallet = c.get("walletAddress");

  if (!tokenAddress || !wallet) {
    throw new ApiError(400, "invalid_params", "Invalid chain or token address");
  }

  // Require 10+ heat degrees on this token to post
  const heatDegrees = await getWalletTokenHeat(tokenAddress, wallet) ?? 0;
  if (heatDegrees < 10) {
    throw new ApiError(403, 'insufficient_heat', 'You need at least 10 heat degrees on this token to post');
  }

  const body = await c.req.json<{ content?: string; image_url?: string }>();
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content || content.length === 0) {
    throw new ApiError(400, "invalid_content", "Post content cannot be empty");
  }
  if (content.length > 280) {
    throw new ApiError(400, "content_too_long", "Post content must be 280 characters or less");
  }

  let imageUrl: string | null = null;
  if (body.image_url && typeof body.image_url === "string") {
    try {
      new URL(body.image_url);
      imageUrl = body.image_url;
    } catch {
      throw new ApiError(400, "invalid_image_url", "Image URL is not a valid URL");
    }
  }

  const post = await createBulletinPost({
    tokenAddress,
    chain,
    wallet,
    content,
    imageUrl,
  });

  logInfo("BULLETIN POST", `wallet=${wallet} token=${tokenAddress} post_id=${post.id}`);

  return c.json({
    id: post.id,
    wallet: post.wallet,
    content: post.content,
    image_url: post.image_url,
    created_at: post.created_at,
  }, 201);
});

export default bungalowRoute;
