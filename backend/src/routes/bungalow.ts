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
import {
  getCanonicalProjectContext,
  type CanonicalDeploymentRef,
} from "../services/canonicalProjects";
import { ApiError } from "../services/errors";
import {
  getHomeTeamToken,
  isPlaceholderMetadataLabel,
  pickMetadataLabel,
} from "../services/homeTeam";
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

interface BungalowMarketDataResponse {
  price_usd: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  liquidity_usd: number | null;
  updated_at: string | null;
}

interface LinkedDeploymentView {
  chain: string;
  token_address: string;
  route_path: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  is_nft: boolean;
  exists: boolean;
  is_claimed: boolean;
  is_verified: boolean;
  current_owner: string | null;
  description: string | null;
  origin_story: string | null;
  image_url: string | null;
  holder_count: number;
  total_supply: string | null;
  market_data: BungalowMarketDataResponse | null;
  links: {
    x: string | null;
    farcaster: string | null;
    telegram: string | null;
    website: string | null;
    dexscreener: string | null;
  };
  heat_stats: {
    sample_size: number;
    top_50_average: number | null;
    top_50_stddev: number | null;
  };
  is_primary: boolean;
  is_active: boolean;
}

function toMarketData(
  input:
    | {
        price_usd: string | null;
        market_cap: string | null;
        volume_24h: string | null;
        liquidity_usd: string | null;
        metadata_updated_at: string | null;
      }
    | null
    | undefined,
): BungalowMarketDataResponse | null {
  if (!input) return null;

  return {
    price_usd: input.price_usd ? Number(input.price_usd) : null,
    market_cap: input.market_cap ? Number(input.market_cap) : null,
    volume_24h: input.volume_24h ? Number(input.volume_24h) : null,
    liquidity_usd: input.liquidity_usd ? Number(input.liquidity_usd) : null,
    updated_at: input.metadata_updated_at ?? null,
  };
}

async function buildLinkedDeploymentView(input: {
  deployment: CanonicalDeploymentRef;
  isPrimary: boolean;
  isActive: boolean;
}): Promise<LinkedDeploymentView> {
  const { deployment } = input;

  const [bungalow, tokenRegistry] = await Promise.all([
    getBungalow(deployment.token_address, deployment.chain),
    getTokenRegistry(deployment.token_address, deployment.chain),
  ]);

  const seededMetadata = getHomeTeamToken(deployment.chain, deployment.token_address);
  const needsFallbackMetadata =
    !bungalow ||
    !bungalow.image_url ||
    isPlaceholderMetadataLabel(bungalow.name) ||
    isPlaceholderMetadataLabel(bungalow.symbol) ||
    isPlaceholderMetadataLabel(tokenRegistry?.name) ||
    isPlaceholderMetadataLabel(tokenRegistry?.symbol);

  const fallbackMetadata = needsFallbackMetadata
    ? await resolveTokenMetadata(deployment.token_address, deployment.chain).catch(
        () => null,
      )
    : null;

  const exists = Boolean(bungalow || tokenRegistry);
  const holdersResult = exists
    ? await getTokenHolders(deployment.token_address, 50, 0).catch(() => ({
        holders: [],
        total: 0,
      }))
    : { holders: [], total: 0 };

  const decimals = tokenRegistry?.decimals ?? null;

  return {
    chain: deployment.chain,
    token_address: deployment.token_address,
    route_path: `/${deployment.chain}/${deployment.token_address}`,
    name: pickMetadataLabel(
      bungalow?.name,
      tokenRegistry?.name,
      seededMetadata?.name,
      fallbackMetadata?.name,
    ),
    symbol: pickMetadataLabel(
      bungalow?.symbol,
      tokenRegistry?.symbol,
      seededMetadata?.symbol,
      fallbackMetadata?.symbol,
    ),
    decimals,
    is_nft: decimals === 0,
    exists,
    is_claimed: bungalow?.is_claimed ?? false,
    is_verified: bungalow?.is_verified ?? false,
    current_owner: bungalow?.current_owner ?? null,
    description: bungalow?.description ?? fallbackMetadata?.description ?? null,
    origin_story: bungalow?.origin_story ?? null,
    image_url:
      bungalow?.image_url ??
      seededMetadata?.image_url ??
      fallbackMetadata?.image_url ??
      null,
    holder_count: bungalow?.holder_count ?? tokenRegistry?.holder_count ?? 0,
    total_supply: bungalow?.total_supply ?? tokenRegistry?.total_supply ?? null,
    market_data: toMarketData(bungalow) ?? fallbackMetadata?.market_data ?? null,
    links: {
      x: bungalow?.link_x ?? fallbackMetadata?.links.x ?? null,
      farcaster: bungalow?.link_farcaster ?? fallbackMetadata?.links.farcaster ?? null,
      telegram: bungalow?.link_telegram ?? fallbackMetadata?.links.telegram ?? null,
      website: bungalow?.link_website ?? fallbackMetadata?.links.website ?? null,
      dexscreener:
        bungalow?.link_dexscreener ?? fallbackMetadata?.links.dexscreener ?? null,
    },
    heat_stats: calculateTopHeatStats(
      holdersResult.holders.map((holder) => Number(holder.heat_degrees)),
    ),
    is_primary: input.isPrimary,
    is_active: input.isActive,
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

  const projectContext = getCanonicalProjectContext(chain, tokenAddress);
  const deploymentViews = await Promise.all(
    projectContext.deployments.map((deployment) =>
      buildLinkedDeploymentView({
        deployment,
        isPrimary:
          deployment.chain === projectContext.primaryDeployment.chain &&
          deployment.token_address === projectContext.primaryDeployment.token_address,
        isActive:
          deployment.chain === chain && deployment.token_address === tokenAddress,
      }),
    ),
  );

  const activeDeployment =
    deploymentViews.find((deployment) => deployment.is_active) ?? deploymentViews[0];
  const primaryDeployment =
    deploymentViews.find((deployment) => deployment.is_primary) ?? activeDeployment;
  const firstExistingDeployment =
    deploymentViews.find((deployment) => deployment.exists) ?? null;
  const displaySource = firstExistingDeployment ?? activeDeployment;
  const canonicalExists = Boolean(firstExistingDeployment);
  const aggregateHolderCount = deploymentViews.reduce(
    (sum, deployment) => sum + Math.max(0, deployment.holder_count),
    0,
  );
  const chainCount = new Set(deploymentViews.map((deployment) => deployment.chain))
    .size;
  const canonicalProject = {
    id:
      projectContext.project?.id ??
      `${displaySource.chain}:${displaySource.token_address}`,
    slug: projectContext.project?.slug ?? null,
    name: projectContext.project?.name ?? displaySource.name,
    symbol: projectContext.project?.symbol ?? displaySource.symbol,
    chain_count: chainCount,
    deployment_count: deploymentViews.length,
    total_holder_count: aggregateHolderCount,
    primary_deployment: {
      chain: primaryDeployment.chain,
      token_address: primaryDeployment.token_address,
    },
    active_deployment: {
      chain: activeDeployment.chain,
      token_address: activeDeployment.token_address,
    },
  };

  if (!canonicalExists) {
    const notFound = {
      token_address: tokenAddress,
      chain,
      name: canonicalProject.name,
      symbol: canonicalProject.symbol,
      decimals: activeDeployment.decimals,
      is_nft: activeDeployment.is_nft,
      exists: false,
      is_claimed: false,
      is_verified: false,
      current_owner: null,
      description: activeDeployment.description,
      origin_story: null,
      image_url: activeDeployment.image_url,
      holder_count: 0,
      total_supply: null,
      market_data: activeDeployment.market_data,
      links: activeDeployment.links,
      heat_stats: activeDeployment.heat_stats,
      holders: [],
      heat_distribution: null,
      canonical_project: canonicalProject,
      deployments: deploymentViews,
      active_deployment: activeDeployment,
    };
    setCached(cacheKey, notFound, CONFIG.BUNGALOW_CACHE_MS);
    return c.json(notFound);
  }

  const heatContextDeployment = activeDeployment.exists
    ? activeDeployment
    : displaySource;
  const [holdersResult, heatDistribution] = await Promise.all([
    getTokenHolders(heatContextDeployment.token_address, 50, 0).catch(() => ({
      holders: [],
      total: 0,
    })),
    getTokenHeatDistribution(heatContextDeployment.token_address).catch(() => null),
  ]);

  const response: Record<string, unknown> = {
    token_address: tokenAddress,
    chain,
    name: canonicalProject.name,
    symbol: canonicalProject.symbol,
    decimals: displaySource.decimals,
    is_nft: displaySource.is_nft,
    exists: true,
    is_claimed: displaySource.is_claimed,
    is_verified: displaySource.is_verified,
    current_owner: displaySource.current_owner,
    description: displaySource.description,
    origin_story: displaySource.origin_story,
    image_url: displaySource.image_url,
    holder_count: aggregateHolderCount,
    total_supply: displaySource.total_supply,
    market_data: displaySource.market_data,
    links: displaySource.links,
    heat_stats: heatContextDeployment.heat_stats,
    holders: holdersResult.holders.map((holder, idx) => ({
      rank: idx + 1,
      wallet: holder.wallet,
      heat_degrees: Number(holder.heat_degrees),
      farcaster: holder.fid
        ? {
            fid: holder.fid,
            username: holder.username,
            pfp_url: holder.pfp_url,
          }
        : null,
    })),
    heat_distribution: heatDistribution,
    canonical_project: canonicalProject,
    deployments: deploymentViews,
    active_deployment: activeDeployment,
  };

  if (viewerWallet) {
    const viewerIsOwner = Boolean(
      displaySource.current_owner &&
      viewerWallet.toLowerCase() === displaySource.current_owner.toLowerCase(),
    );
    const [viewerProfile, walletHeat] = await Promise.all([
      getViewerProfile(viewerWallet),
      getWalletTokenHeat(heatContextDeployment.token_address, viewerWallet),
    ]);

    response.viewer_context = {
      wallet: viewerWallet,
      is_owner: viewerIsOwner,
      holds_token: walletHeat !== null,
      token_heat_degrees: walletHeat ?? 0,
      island_heat: viewerProfile?.islandHeat ?? 0,
      tier: viewerProfile?.tier ?? "drifter",
    };
  }

  setCached(cacheKey, response, CONFIG.BUNGALOW_CACHE_MS);
  logInfo(
    "BUNGALOW RESP",
    `request_id=${requestId} token=${tokenAddress} chain=${chain} exists=true deployments=${deploymentViews.length} claimed=${displaySource.is_claimed}`,
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
  for (const deployment of getCanonicalProjectContext(chain, tokenAddress).deployments) {
    clearCache(`bungalow:${deployment.chain}:${deployment.token_address}`);
  }
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
