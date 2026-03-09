import { Hono } from "hono";
import {
  CONFIG,
  db,
  normalizeAddress,
  publicClients,
  toSupportedChain,
  type SupportedChain,
} from "../config";
import {
  createBungalowWallEvent,
  createBulletinPost,
  findTokenDeploymentsByAddress,
  getAggregatedUserByWallets,
  getBulletinPosts,
  getBungalowWallFeed,
  getBungalow,
  getBungalowOwnerRecord,
  getIdentityClusterByWallet,
  getTokenHeatDistribution,
  getTokenHolders,
  getTokenRegistry,
  getUserWallets,
  getViewerProfile,
  getWalletTokenBalanceRaw,
  getWalletTokenHeat,
  getWalletTokenHeats,
  updateBungalowCuration,
  upsertUser,
  upsertUserWalletLinks,
} from "../db/queries";
import { optionalWalletContext, requireWalletAuth } from "../middleware/auth";
import { getPrivyLinkedAccounts } from "../services/privyClaims";
import { clearCache, getCached, setCached } from "../services/cache";
import {
  COMMUNITY_POLICY,
  getConstructionQualification,
} from "../services/communityPolicy";
import {
  getCanonicalProjectContext,
  getCanonicalProjectContextByIdentifier,
  getCanonicalProjectContextBySlug,
  type BungalowAssetKind,
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

function extractXUsernameFromClaims(claims: Record<string, unknown>): string | null {
  const linkedAccounts = getPrivyLinkedAccounts(claims);
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type : "";
    if (type === "twitter_oauth" || type === "twitter") {
      const raw =
        typeof candidate.username === "string"
          ? candidate.username
          : typeof candidate.screen_name === "string"
            ? candidate.screen_name
            : "";
      const clean = raw.trim().replace(/^@+/, "");
      if (clean) return `@${clean}`;
    }
  }
  return null;
}

function persistActorIdentity(
  wallet: string,
  privyUserId: string,
  privyClaims: Record<string, unknown> | undefined,
): void {
  const xUsername = privyClaims ? extractXUsernameFromClaims(privyClaims) : null;
  const walletKind: "privy_siwe" | "privy_siws" = normalizeAddress(wallet)
    ? "privy_siwe"
    : "privy_siws";
  void upsertUserWalletLinks(privyUserId, wallet, walletKind).catch(() => {});
  if (xUsername) {
    void upsertUser(privyUserId, { x_username: xUsername }).catch(() => {});
  }
}

let communityConstructionTablesPromise: Promise<void> | null = null;
const balanceOfReadAbi = [
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

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

async function ensureCommunityConstructionTables(): Promise<void> {
  if (!communityConstructionTablesPromise) {
    communityConstructionTablesPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_construction_supports (
          id BIGSERIAL PRIMARY KEY,
          chain TEXT NOT NULL,
          token_address TEXT NOT NULL,
          identity_key TEXT NOT NULL,
          supporter_wallet TEXT NOT NULL,
          island_heat NUMERIC NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (chain, token_address, identity_key)
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_construction_supports_token
        ON ${db(CONFIG.SCHEMA)}.bungalow_construction_supports (chain, token_address, created_at DESC)
      `;

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_construction_events (
          id BIGSERIAL PRIMARY KEY,
          chain TEXT NOT NULL,
          token_address TEXT NOT NULL,
          identity_key TEXT NOT NULL,
          requested_by_wallet TEXT NOT NULL,
          qualification_path TEXT NOT NULL CHECK (
            qualification_path IN ('single_hot_wallet', 'community_support', 'jbac_shortcut')
          ),
          tx_hash TEXT UNIQUE NOT NULL,
          jbm_amount NUMERIC NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_construction_events_token
        ON ${db(CONFIG.SCHEMA)}.bungalow_construction_events (chain, token_address, created_at DESC)
      `;
    })();
  }

  await communityConstructionTablesPromise;
}

function validateTxHash(input: unknown): string {
  const txHash = typeof input === "string" ? input.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, "invalid_tx_hash", "tx_hash must be a valid transaction hash");
  }
  return txHash.toLowerCase();
}

function parseWholeJbmAmount(input: unknown, fieldName: string): bigint {
  if (typeof input === "bigint") {
    if (input <= 0n) {
      throw new ApiError(400, "invalid_numeric", `${fieldName} must be a positive JBM amount`);
    }
    return input;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input <= 0) {
      throw new ApiError(400, "invalid_numeric", `${fieldName} must be a whole-number JBM amount`);
    }
    return BigInt(input);
  }

  const raw = typeof input === "string" ? input.trim() : "";
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, "invalid_numeric", `${fieldName} must be a whole-number JBM amount`);
  }

  return BigInt(raw);
}

async function getIslandHeatSnapshot(wallet: string): Promise<{
  identityKey: string;
  islandHeat: number;
  wallets: string[];
  evmWallets: string[];
  jbacBalance: bigint;
}> {
  const identity = await getIdentityClusterByWallet(wallet);
  const scopedWallets = identity?.wallets.length
    ? identity.wallets.map((entry) => entry.wallet)
    : [wallet];
  const evmWallets = identity?.evm_wallets ?? [];
  const aggregated = await getAggregatedUserByWallets(scopedWallets);
  const islandHeat = aggregated?.island_heat ?? 0;
  const uniqueEvmWallets = [...new Set(evmWallets.map((entry) => entry.toLowerCase()))]
    .map((entry) => normalizeAddress(entry))
    .filter((entry): entry is string => Boolean(entry));

  let onchainBalance: bigint | null = null;
  if (uniqueEvmWallets.length > 0) {
    let hasSuccessfulRead = false;
    const balances = await Promise.all(
      uniqueEvmWallets.map(async (entry) => {
        try {
          const balance = await publicClients[
            COMMUNITY_POLICY.jbac_shortcut_chain
          ].readContract({
            address:
              COMMUNITY_POLICY.jbac_shortcut_token_address as `0x${string}`,
            abi: balanceOfReadAbi,
            functionName: "balanceOf",
            args: [entry as `0x${string}`],
          });
          hasSuccessfulRead = true;
          return BigInt(balance);
        } catch {
          return 0n;
        }
      }),
    );

    if (hasSuccessfulRead) {
      onchainBalance = balances.reduce(
        (sum, balance) => sum + balance,
        0n,
      );
    }
  }

  const jbacBalance =
    onchainBalance ??
    (await getWalletTokenBalanceRaw(
      COMMUNITY_POLICY.jbac_shortcut_token_address,
      uniqueEvmWallets,
    ));

  return {
    identityKey: identity?.identity_key ?? `wallet:${wallet}`,
    islandHeat,
    wallets: scopedWallets,
    evmWallets,
    jbacBalance,
  };
}

async function getConstructionSupportSnapshot(
  chain: SupportedChain,
  tokenAddress: string,
  identityKey?: string | null,
): Promise<{
  supporter_count: number;
  has_supported: boolean;
}> {
  await ensureCommunityConstructionTables();

  const [countRows, existingRows] = await Promise.all([
    db<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM ${db(CONFIG.SCHEMA)}.bungalow_construction_supports
      WHERE chain = ${chain}
        AND token_address = ${tokenAddress}
    `,
    identityKey
      ? db<Array<{ id: number }>>`
          SELECT id
          FROM ${db(CONFIG.SCHEMA)}.bungalow_construction_supports
          WHERE chain = ${chain}
            AND token_address = ${tokenAddress}
            AND identity_key = ${identityKey}
          LIMIT 1
        `
      : Promise.resolve([] as Array<{ id: number }>),
  ]);

  return {
    supporter_count: Number(countRows[0]?.count ?? 0),
    has_supported: existingRows.length > 0,
  };
}

function buildCommunityQualificationResponse(input: {
  tokenAddress: string;
  chain: SupportedChain;
  exists: boolean;
  supportCount: number;
  islandHeat?: number;
  hasSupported?: boolean;
  jbacBalance?: bigint;
}) {
  const qualificationPath =
    input.islandHeat === undefined || input.jbacBalance === undefined
      ? null
      : getConstructionQualification({
          islandHeat: input.islandHeat,
          supportCount: input.supportCount,
          jbacBalance: input.jbacBalance,
        });

  return {
    token_address: input.tokenAddress,
    chain: input.chain,
    exists: input.exists,
    construction_fee_jbm:
      COMMUNITY_POLICY.bungalow_construction_fee_jbm.toString(),
    thresholds: {
      submit_heat_min: COMMUNITY_POLICY.bungalow_submit_min_heat,
      support_heat_min: COMMUNITY_POLICY.bungalow_support_min_heat,
      single_builder_heat_min:
        COMMUNITY_POLICY.bungalow_single_builder_min_heat,
      required_supporters: COMMUNITY_POLICY.bungalow_required_supporters,
      jbac_shortcut_min_balance:
        COMMUNITY_POLICY.jbac_shortcut_min_balance.toString(),
      steward_heat_min: COMMUNITY_POLICY.bungalow_steward_min_heat,
    },
    support: {
      supporter_count: input.supportCount,
      required_supporters: COMMUNITY_POLICY.bungalow_required_supporters,
      has_supported: Boolean(input.hasSupported),
      community_support_ready:
        input.supportCount >= COMMUNITY_POLICY.bungalow_required_supporters,
    },
    viewer: input.islandHeat === undefined
      ? null
      : {
          island_heat: Number(input.islandHeat.toFixed(2)),
          jbac_balance: (input.jbacBalance ?? 0n).toString(),
          has_supported: Boolean(input.hasSupported),
          can_submit_to_bungalow:
            input.islandHeat >= COMMUNITY_POLICY.bungalow_submit_min_heat,
          can_support:
            input.islandHeat >= COMMUNITY_POLICY.bungalow_support_min_heat,
          qualifies_to_construct_now: qualificationPath !== null,
          qualification_path: qualificationPath,
        },
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

interface ProjectAssetView {
  id: string;
  kind: BungalowAssetKind;
  name: string;
  symbol: string | null;
  aggregate_holder_count: number;
  deployment_count: number;
  chain_count: number;
  is_primary: boolean;
  is_active: boolean;
  primary_deployment: {
    chain: string;
    token_address: string;
  };
  deployments: LinkedDeploymentView[];
}

interface WalletBungalowDirectoryRow {
  id: number;
  token_address: string;
  chain: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
}

type CanonicalProjectContextResult = Awaited<
  ReturnType<typeof getCanonicalProjectContext>
>;

function walletBungalowKey(chain: string, tokenAddress: string): string {
  return `${chain}:${tokenAddress}`;
}

function walletBungalowSortLabel(row: WalletBungalowDirectoryRow): string {
  return row.name?.trim() || row.symbol?.trim() || row.token_address;
}

function pickDisplayRow(
  rows: WalletBungalowDirectoryRow[],
  context: CanonicalProjectContextResult,
): WalletBungalowDirectoryRow {
  const fungibleDeployments = new Set(
    context.assets
      .filter((asset) => asset.kind === "fungible_token")
      .flatMap((asset) =>
        asset.deployments.map((deployment) =>
          walletBungalowKey(deployment.chain, deployment.token_address),
        ),
      ),
  );

  const preferredTokenRow = rows.find((row) =>
    fungibleDeployments.has(walletBungalowKey(row.chain, row.token_address)),
  );
  if (preferredTokenRow) {
    return preferredTokenRow;
  }

  const primaryOwnedRow = rows.find(
    (row) =>
      row.chain === context.primaryDeployment.chain &&
      row.token_address === context.primaryDeployment.token_address,
  );
  if (primaryOwnedRow) {
    return primaryOwnedRow;
  }

  return [...rows].sort((a, b) =>
    walletBungalowSortLabel(a).localeCompare(walletBungalowSortLabel(b)),
  )[0];
}

function pickPreferredImageDeployment(
  context: CanonicalProjectContextResult,
): CanonicalDeploymentRef {
  const tokenAsset = context.assets.find((asset) => asset.kind === "fungible_token");
  if (tokenAsset) {
    return (
      tokenAsset.deployments.find(
        (deployment) => deployment.chain === tokenAsset.preferred_chain,
      ) ?? tokenAsset.deployments[0]
    );
  }

  const primaryAsset =
    context.assets.find((asset) => asset.id === context.primaryAsset.id) ??
    context.assets[0];
  if (primaryAsset) {
    return (
      primaryAsset.deployments.find(
        (deployment) => deployment.chain === primaryAsset.preferred_chain,
      ) ?? primaryAsset.deployments[0]
    );
  }

  return context.primaryDeployment;
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

function canonicalPathFor(input: {
  slug?: string | null;
  tokenAddress: string;
}): string {
  const identifier = input.slug?.trim() || input.tokenAddress;
  return `/bungalow/${identifier}`;
}

function pickPreferredDeployment(
  context: CanonicalProjectContextResult,
  preferredChain: SupportedChain | null,
): CanonicalDeploymentRef {
  if (!preferredChain) {
    return context.activeDeployment;
  }

  for (const asset of context.assets) {
    const match = asset.deployments.find(
      (deployment) => deployment.chain === preferredChain,
    );
    if (match) {
      return match;
    }
  }

  return context.activeDeployment;
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
    route_path: `/bungalow/${deployment.token_address}`,
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

bungalowRoute.get("/bungalow/resolve/:identifier", async (c) => {
  const identifier = c.req.param("identifier")?.trim() ?? "";
  if (!identifier) {
    throw new ApiError(400, "invalid_params", "Identifier is required");
  }
  const preferredChain = toSupportedChain(
    (c.req.query("chain") ?? "").trim().toLowerCase(),
  );

  const slugContext = await getCanonicalProjectContextBySlug(identifier);
  if (slugContext) {
    const preferredDeployment = pickPreferredDeployment(
      slugContext,
      preferredChain,
    );
    return c.json({
      found: true,
      identifier,
      identifier_type: "slug",
      canonical_slug: slugContext.project?.slug ?? null,
      chain: preferredDeployment.chain,
      token_address: preferredDeployment.token_address,
      canonical_path: canonicalPathFor({
        slug: slugContext.project?.slug ?? null,
        tokenAddress: preferredDeployment.token_address,
      }),
    });
  }

  const canonicalAddressContext = await getCanonicalProjectContextByIdentifier(
    identifier,
  );
  if (canonicalAddressContext) {
    const preferredDeployment = pickPreferredDeployment(
      canonicalAddressContext,
      preferredChain,
    );
    return c.json({
      found: true,
      identifier,
      identifier_type: "address",
      canonical_slug: canonicalAddressContext.project?.slug ?? null,
      chain: preferredDeployment.chain,
      token_address: preferredDeployment.token_address,
      canonical_path: canonicalPathFor({
        slug: canonicalAddressContext.project?.slug ?? null,
        tokenAddress: preferredDeployment.token_address,
      }),
    });
  }

  const candidates = [
    normalizeAddress(identifier, "base"),
    normalizeAddress(identifier, "ethereum"),
    normalizeAddress(identifier, "solana"),
  ].filter((value): value is string => Boolean(value));

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    const matches = await findTokenDeploymentsByAddress(candidate);
    if (matches.length === 0) continue;

    const preferredMatch =
      (preferredChain
        ? matches.find((match) => match.chain === preferredChain)
        : null) ??
      matches.find((match) => match.chain === "base") ??
      matches.find((match) => match.chain === "ethereum") ??
      matches[0];

    return c.json({
      found: true,
      identifier,
      identifier_type: "address",
      canonical_slug: null,
      chain: preferredMatch.chain,
      token_address: preferredMatch.token_address,
      canonical_path: canonicalPathFor({
        tokenAddress: preferredMatch.token_address,
      }),
    });
  }

  throw new ApiError(404, "bungalow_not_found", "Bungalow not found");
});

bungalowRoute.get("/bungalow/resolve/:chain/:ca", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);

  return c.json({
    found: true,
    identifier: tokenAddress,
    identifier_type: "address",
    canonical_slug: projectContext.project?.slug ?? null,
    chain: projectContext.activeDeployment.chain,
    token_address: projectContext.activeDeployment.token_address,
    canonical_path: canonicalPathFor({
      slug: projectContext.project?.slug ?? null,
      tokenAddress: projectContext.activeDeployment.token_address,
    }),
  });
});

bungalowRoute.get("/bungalow/:chain/:ca/qualification", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  const supportDeployment = projectContext.primaryDeployment;
  const rawViewerWallet = c.req.query("viewer_wallet");
  const queryViewerWallet =
    (rawViewerWallet ? normalizeAddress(rawViewerWallet) : null) ??
    (rawViewerWallet ? normalizeAddress(rawViewerWallet, "solana") : null);
  const viewerWallet = queryViewerWallet ?? c.get("walletAddress") ?? null;
  const [bungalow, tokenRegistry, fallbackMetadata, supportSnapshot, viewerSnapshot] =
    await Promise.all([
      getBungalow(supportDeployment.token_address, supportDeployment.chain),
      getTokenRegistry(supportDeployment.token_address, supportDeployment.chain),
      resolveTokenMetadata(
        supportDeployment.token_address,
        supportDeployment.chain,
      ).catch(() => null),
      getConstructionSupportSnapshot(
        supportDeployment.chain,
        supportDeployment.token_address,
        null,
      ),
      viewerWallet ? getIslandHeatSnapshot(viewerWallet) : Promise.resolve(null),
    ]);

  const exists = Boolean(
    bungalow?.is_claimed || bungalow?.verified_admin || bungalow?.current_owner,
  );
  const viewerSupport = viewerSnapshot
    ? await getConstructionSupportSnapshot(
        supportDeployment.chain,
        supportDeployment.token_address,
        viewerSnapshot.identityKey,
      )
    : null;

  return c.json({
    ...buildCommunityQualificationResponse({
      tokenAddress: supportDeployment.token_address,
      chain: supportDeployment.chain,
      exists,
      supportCount: supportSnapshot.supporter_count,
      islandHeat: viewerSnapshot?.islandHeat,
      hasSupported: viewerSupport?.has_supported,
      jbacBalance: viewerSnapshot?.jbacBalance,
    }),
    token: {
      name:
        bungalow?.name ??
        tokenRegistry?.name ??
        fallbackMetadata?.name ??
        null,
      symbol:
        bungalow?.symbol ??
        tokenRegistry?.symbol ??
        fallbackMetadata?.symbol ??
        null,
      image_url:
        bungalow?.image_url ??
        fallbackMetadata?.image_url ??
        null,
    },
    canonical_path: canonicalPathFor({
      slug: projectContext.project?.slug ?? null,
      tokenAddress: supportDeployment.token_address,
    }),
  });
});

bungalowRoute.post("/bungalow/:chain/:ca/support", requireWalletAuth, async (c) => {
  await ensureCommunityConstructionTables();

  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  const wallet = c.get("walletAddress");
  if (!tokenAddress || !wallet) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  const supportDeployment = projectContext.primaryDeployment;
  const bungalow = await getBungalow(
    supportDeployment.token_address,
    supportDeployment.chain,
  );
  const existingSupportSnapshot = await getConstructionSupportSnapshot(
    supportDeployment.chain,
    supportDeployment.token_address,
    null,
  );
  const exists = Boolean(
    bungalow?.is_claimed || bungalow?.verified_admin || bungalow?.current_owner,
  );
  if (exists) {
    return c.json({
      ...buildCommunityQualificationResponse({
        tokenAddress: supportDeployment.token_address,
        chain: supportDeployment.chain,
        exists: true,
        supportCount: existingSupportSnapshot.supporter_count,
      }),
      idempotent: true,
    });
  }

  const viewerSnapshot = await getIslandHeatSnapshot(wallet);
  if (viewerSnapshot.islandHeat < COMMUNITY_POLICY.bungalow_support_min_heat) {
    throw new ApiError(
      403,
      "insufficient_heat",
      `You need at least ${COMMUNITY_POLICY.bungalow_support_min_heat} island heat to back a new bungalow. Current heat: ${viewerSnapshot.islandHeat.toFixed(1)}`,
    );
  }

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_construction_supports (
      chain,
      token_address,
      identity_key,
      supporter_wallet,
      island_heat
    )
    VALUES (
      ${supportDeployment.chain},
      ${supportDeployment.token_address},
      ${viewerSnapshot.identityKey},
      ${wallet},
      ${viewerSnapshot.islandHeat}
    )
    ON CONFLICT (chain, token_address, identity_key)
    DO UPDATE SET
      supporter_wallet = EXCLUDED.supporter_wallet,
      island_heat = EXCLUDED.island_heat
  `;

  const supportSnapshot = await getConstructionSupportSnapshot(
    supportDeployment.chain,
    supportDeployment.token_address,
    viewerSnapshot.identityKey,
  );

  return c.json({
    ...buildCommunityQualificationResponse({
      tokenAddress: supportDeployment.token_address,
      chain: supportDeployment.chain,
      exists: false,
      supportCount: supportSnapshot.supporter_count,
      islandHeat: viewerSnapshot.islandHeat,
      hasSupported: supportSnapshot.has_supported,
      jbacBalance: viewerSnapshot.jbacBalance,
    }),
    supported: true,
  });
});

bungalowRoute.post("/bungalow/:chain/:ca/construct", requireWalletAuth, async (c) => {
  await ensureCommunityConstructionTables();

  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  const wallet = c.get("walletAddress");
  if (!tokenAddress || !wallet) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  const storageDeployment = projectContext.primaryDeployment;
  const existingBungalow = await getBungalow(
    storageDeployment.token_address,
    storageDeployment.chain,
  );
  const exists = Boolean(
    existingBungalow?.is_claimed ||
      existingBungalow?.verified_admin ||
      existingBungalow?.current_owner,
  );
  if (exists) {
    throw new ApiError(409, "already_exists", "This bungalow is already on the island");
  }

  const body = await c.req.json<{ tx_hash?: unknown; jbm_amount?: unknown }>();
  const txHash = validateTxHash(body.tx_hash);
  const jbmAmount = parseWholeJbmAmount(body.jbm_amount, "jbm_amount");
  if (jbmAmount !== COMMUNITY_POLICY.bungalow_construction_fee_jbm) {
    throw new ApiError(
      400,
      "invalid_construction_fee",
      `jbm_amount must equal ${COMMUNITY_POLICY.bungalow_construction_fee_jbm.toString()} for bungalow construction`,
    );
  }

  const duplicateRows = await db<Array<{ id: number }>>`
    SELECT id
    FROM ${db(CONFIG.SCHEMA)}.bungalow_construction_events
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `;
  if (duplicateRows.length > 0) {
    return c.json({
      ok: true,
      idempotent: true,
      bungalow: {
        chain: storageDeployment.chain,
        token_address: storageDeployment.token_address,
        canonical_path: canonicalPathFor({
          slug: projectContext.project?.slug ?? null,
          tokenAddress: storageDeployment.token_address,
        }),
      },
    });
  }

  const viewerSnapshot = await getIslandHeatSnapshot(wallet);
  const supportSnapshot = await getConstructionSupportSnapshot(
    storageDeployment.chain,
    storageDeployment.token_address,
    viewerSnapshot.identityKey,
  );
  const qualificationPath = getConstructionQualification({
    islandHeat: viewerSnapshot.islandHeat,
    supportCount: supportSnapshot.supporter_count,
    jbacBalance: viewerSnapshot.jbacBalance,
  });
  if (!qualificationPath) {
    throw new ApiError(
      403,
      "not_qualified",
      "This contract has not met the current community construction thresholds yet",
    );
  }

  const [registry, fallbackMetadata] = await Promise.all([
    getTokenRegistry(storageDeployment.token_address, storageDeployment.chain),
    resolveTokenMetadata(
      storageDeployment.token_address,
      storageDeployment.chain,
    ).catch(() => null),
  ]);

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
      token_address,
      chain,
      name,
      symbol,
      verified_admin,
      is_claimed,
      updated_at
    )
    VALUES (
      ${storageDeployment.token_address},
      ${storageDeployment.chain},
      ${registry?.name ?? fallbackMetadata?.name ?? null},
      ${registry?.symbol ?? fallbackMetadata?.symbol ?? null},
      ${wallet},
      TRUE,
      NOW()
    )
    ON CONFLICT (token_address)
    DO UPDATE SET
      chain = EXCLUDED.chain,
      name = COALESCE(EXCLUDED.name, ${db(CONFIG.SCHEMA)}.bungalows.name),
      symbol = COALESCE(EXCLUDED.symbol, ${db(CONFIG.SCHEMA)}.bungalows.symbol),
      verified_admin = COALESCE(${db(CONFIG.SCHEMA)}.bungalows.verified_admin, EXCLUDED.verified_admin),
      is_claimed = TRUE,
      updated_at = NOW()
  `;

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_construction_events (
      chain,
      token_address,
      identity_key,
      requested_by_wallet,
      qualification_path,
      tx_hash,
      jbm_amount
    )
    VALUES (
      ${storageDeployment.chain},
      ${storageDeployment.token_address},
      ${viewerSnapshot.identityKey},
      ${wallet},
      ${qualificationPath},
      ${txHash},
      ${jbmAmount.toString()}
    )
  `;

  for (const deployment of projectContext.deployments) {
    clearCache(`bungalow:${deployment.chain}:${deployment.token_address}`);
  }

  return c.json({
    ok: true,
    qualification_path: qualificationPath,
    bungalow: {
      chain: storageDeployment.chain,
      token_address: storageDeployment.token_address,
      canonical_path: canonicalPathFor({
        slug: projectContext.project?.slug ?? null,
        tokenAddress: storageDeployment.token_address,
      }),
    },
  });
});

bungalowRoute.get("/address/:wallet/bungalows", async (c) => {
  const walletRaw = c.req.param("wallet");
  const wallet =
    normalizeAddress(walletRaw) ?? normalizeAddress(walletRaw, "solana");
  if (!wallet) {
    throw new ApiError(400, "invalid_wallet", "Invalid wallet address");
  }

  const identityCluster = await getIdentityClusterByWallet(wallet);
  const scopedWallets = identityCluster?.wallets.length
    ? identityCluster.wallets.map((entry) => entry.wallet)
    : [wallet];

  const rows = await db<WalletBungalowDirectoryRow[]>`
    SELECT
      id,
      token_address,
      chain,
      NULLIF(btrim(name), '') AS name,
      NULLIF(btrim(symbol), '') AS symbol,
      image_url
    FROM ${db(CONFIG.SCHEMA)}.bungalows
    WHERE current_owner IN ${db(scopedWallets)}
      OR verified_admin IN ${db(scopedWallets)}
    ORDER BY
      COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(symbol), ''), token_address) ASC,
      id ASC
  `;

  if (rows.length === 0) {
    return c.json([]);
  }

  const groupedRows = new Map<string, { context: CanonicalProjectContextResult; rows: WalletBungalowDirectoryRow[] }>();

  const resolvedRows = await Promise.all(
    rows.map(async (row) => ({
      row,
      context: await getCanonicalProjectContext(
        row.chain as SupportedChain,
        row.token_address,
      ),
    })),
  );

  for (const entry of resolvedRows) {
    const groupKey =
      entry.context.project?.id ??
      walletBungalowKey(
        entry.context.primaryDeployment.chain,
        entry.context.primaryDeployment.token_address,
      );
    const existing = groupedRows.get(groupKey);
    if (existing) {
      existing.rows.push(entry.row);
      continue;
    }

    groupedRows.set(groupKey, {
      context: entry.context,
      rows: [entry.row],
    });
  }

  const directory = await Promise.all(
    [...groupedRows.values()].map(async (group) => {
      const displayRow = pickDisplayRow(group.rows, group.context);
      const imageDeployment = pickPreferredImageDeployment(group.context);

      const [displayBungalow, displayTokenRegistry, imageBungalow] =
        await Promise.all([
          getBungalow(displayRow.token_address, displayRow.chain),
          getTokenRegistry(displayRow.token_address, displayRow.chain),
          getBungalow(imageDeployment.token_address, imageDeployment.chain),
        ]);

      return {
        id: displayRow.id,
        token_address: displayRow.token_address,
        chain: displayRow.chain,
        name:
          group.context.project?.name ??
          displayBungalow?.name ??
          displayTokenRegistry?.name ??
          displayRow.name,
        symbol:
          group.context.project?.symbol ??
          displayBungalow?.symbol ??
          displayTokenRegistry?.symbol ??
          displayRow.symbol,
        image_url:
          imageBungalow?.image_url ??
          displayBungalow?.image_url ??
          group.rows.find((row) => row.image_url)?.image_url ??
          null,
      };
    }),
  );

  directory.sort((a, b) =>
    walletBungalowSortLabel(a).localeCompare(walletBungalowSortLabel(b)),
  );

  return c.json(directory);
});

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

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
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
  const assetViews: ProjectAssetView[] = projectContext.assets.map((asset) => {
    const assetDeployments = deploymentViews.filter((deployment) =>
      asset.deployments.some(
        (candidate) =>
          candidate.chain === deployment.chain &&
          candidate.token_address === deployment.token_address,
      ),
    );
    const primaryAssetDeployment =
      assetDeployments.find(
        (deployment) => deployment.chain === asset.preferred_chain,
      ) ?? assetDeployments[0];

    return {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      symbol: asset.symbol,
      aggregate_holder_count: assetDeployments.reduce(
        (sum, deployment) => sum + Math.max(0, deployment.holder_count),
        0,
      ),
      deployment_count: assetDeployments.length,
      chain_count: new Set(assetDeployments.map((deployment) => deployment.chain))
        .size,
      is_primary: asset.id === projectContext.primaryAsset.id,
      is_active: asset.id === projectContext.activeAsset.id,
      primary_deployment: {
        chain: primaryAssetDeployment?.chain ?? asset.preferred_chain,
        token_address:
          primaryAssetDeployment?.token_address ??
          asset.deployments[0]?.token_address ??
          tokenAddress,
      },
      deployments: assetDeployments,
    };
  });
  const activeAssetView = assetViews.find((asset) => asset.is_active) ?? assetViews[0];

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
    symbol:
      projectContext.project?.symbol ??
      activeAssetView?.symbol ??
      displaySource.symbol,
    asset_count: assetViews.length,
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
      assets: assetViews,
      active_asset: activeAssetView,
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
    symbol: activeAssetView?.symbol ?? canonicalProject.symbol,
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
    assets: assetViews,
    active_asset: activeAssetView,
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
  const viewerSnapshot = await getIslandHeatSnapshot(wallet);
  const isCommunitySteward =
    viewerSnapshot.islandHeat >= COMMUNITY_POLICY.bungalow_steward_min_heat;

  if (
    !isCommunitySteward &&
    owner !== caller &&
    admin !== caller
  ) {
    throw new ApiError(
      403,
      "not_bungalow_steward",
      "Only approved community stewards can curate this page",
    );
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
  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  for (const deployment of projectContext.deployments) {
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

bungalowRoute.get("/bungalow/:chain/:ca/wall", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const limit = Math.min(Number(c.req.query("limit")) || 30, 60);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  const result = await getBungalowWallFeed(tokenAddress, chain, limit, offset);

  return c.json({
    items: result.items,
    total: result.total,
  });
});

bungalowRoute.post("/bungalow/:chain/:ca/visit", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_params", "Invalid token address");
  }

  const wallet = c.get("walletAddress") ?? null;
  const privyUserId = c.get("privyUserId") ?? null;
  let islandHeat = 0;
  let tokenHeat = 0;

  if (wallet) {
    const identity = await getIdentityClusterByWallet(wallet);
    const scopedWallets = identity?.wallets.map((entry) => entry.wallet) ?? [wallet];
    const [aggregated, tokenHeats, fallbackProfile] = await Promise.all([
      getAggregatedUserByWallets(scopedWallets),
      getWalletTokenHeats(tokenAddress, scopedWallets),
      getViewerProfile(wallet),
    ]);

    islandHeat = aggregated?.island_heat ?? fallbackProfile?.islandHeat ?? 0;
    tokenHeat = tokenHeats.reduce((sum, entry) => sum + entry.heat_degrees, 0);

    if (privyUserId) {
      persistActorIdentity(
        wallet,
        privyUserId,
        c.get("privyClaims") as Record<string, unknown> | undefined,
      );
    }
  }

  await createBungalowWallEvent({
    tokenAddress,
    chain,
    wallet,
    eventType: "visit",
    detail: null,
    islandHeat,
    tokenHeat,
  });

  return c.json({ ok: true });
});

bungalowRoute.post("/bungalow/:chain/:ca/bulletin", requireWalletAuth, async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_params", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  const wallet = c.get("walletAddress");
  const walletAddressesFromContext = c.get("walletAddresses") ?? [];
  const privyUserId = c.get("privyUserId") ?? null;

  if (!tokenAddress || !wallet) {
    throw new ApiError(400, "invalid_params", "Invalid chain or token address");
  }

  if (privyUserId) {
    persistActorIdentity(
      wallet,
      privyUserId,
      c.get("privyClaims") as Record<string, unknown> | undefined,
    );
  }

  const storedWallets = privyUserId
    ? (await getUserWallets(privyUserId))
        .map((entry) => normalizeAddress(entry.address) ?? normalizeAddress(entry.address, "solana"))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const scopedWallets = [...new Set([wallet, ...walletAddressesFromContext, ...storedWallets])];
  const scopedHeatRows = await getWalletTokenHeats(tokenAddress, scopedWallets);
  const heatDegrees =
    scopedHeatRows.reduce((sum, entry) => sum + entry.heat_degrees, 0) ||
    (await getWalletTokenHeat(tokenAddress, wallet)) ||
    0;

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
