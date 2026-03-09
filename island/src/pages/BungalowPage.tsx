import { Suspense, lazy, useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import ChainIcon from "../components/ChainIcon";
import {
  useBungalow,
  type BungalowAsset,
  type BungalowDeployment,
  type BungalowDetails,
} from "../hooks/useBungalow";
import { useBungalowResolver } from "../hooks/useBungalowResolver";
import { getChainLabel } from "../utils/chains";
import { normalizeBodegaCatalogItem } from "../utils/bodega";
import NotFoundPage from "./NotFoundPage";
import { formatNumber } from "../utils/formatters";
import { getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bungalow-page.module.css";

const BungalowScene = lazy(() => import("../components/BungalowScene"));

function tokenStandardLabel(chain: string, isNft: boolean): string {
  if (chain === "base" || chain === "ethereum") {
    return isNft ? "ERC-721" : "ERC-20";
  }
  return isNft ? "SPL NFT" : "SPL";
}

function chainToneClass(chain: string): string {
  if (chain === "base") return styles.base;
  if (chain === "ethereum") return styles.ethereum;
  return styles.solana;
}

function formatHeatMetric(
  value: number | null | undefined,
  sampleSize: number | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!sampleSize || sampleSize <= 0) return `${value.toFixed(2)}°`;
  return `${value.toFixed(2)}° `;
}

function buildFallbackAsset(bungalow: BungalowDetails): BungalowAsset {
  const deployment: BungalowDeployment = {
    chain: bungalow.chain,
    token_address: bungalow.token_address,
    route_path: `/bungalow/${bungalow.token_address}`,
    name: bungalow.name,
    symbol: bungalow.symbol,
    decimals: bungalow.decimals ?? null,
    is_nft: bungalow.is_nft ?? false,
    exists: bungalow.exists,
    is_claimed: bungalow.is_claimed,
    is_verified: bungalow.is_verified,
    current_owner: bungalow.current_owner,
    description: bungalow.description,
    origin_story: null,
    image_url: bungalow.image_url,
    holder_count: bungalow.holder_count,
    total_supply: null,
    market_data: bungalow.market_data,
    heat_stats: bungalow.heat_stats,
    is_primary: true,
    is_active: true,
  };

  return {
    id: `${bungalow.chain}-${bungalow.token_address}`,
    kind: bungalow.is_nft ? "nft_collection" : "fungible_token",
    name: bungalow.name ?? "Token",
    symbol: bungalow.symbol,
    aggregate_holder_count: bungalow.holder_count,
    deployment_count: 1,
    chain_count: 1,
    is_primary: true,
    is_active: true,
    primary_deployment: {
      chain: bungalow.chain,
      token_address: bungalow.token_address,
    },
    deployments: [deployment],
  };
}

function getVerifiedAdminAddress(bungalow: BungalowDetails): string | null {
  if (!("verified_admin" in bungalow)) {
    return null;
  }

  return typeof bungalow.verified_admin === "string"
    ? bungalow.verified_admin
    : null;
}

function BungalowEntryTransition({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string;
}) {
  const [scale, setScale] = useState(0.3);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setScale(1.1);
      setOpacity(1);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: 520,
        background:
          "radial-gradient(ellipse at center, #1a3a1a 0%, #0a1a0a 70%)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 200,
          height: 200,
          borderRadius: "50%",
          border: "1px solid rgba(0,255,180,0.15)",
          animation: "pulse-ring 1.2s ease-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 140,
          height: 140,
          borderRadius: "50%",
          border: "1px solid rgba(0,255,180,0.2)",
          animation: "pulse-ring 1.2s ease-out 0.3s infinite",
        }}
      />
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid rgba(0,255,180,0.4)",
          opacity,
          transform: `scale(${scale})`,
          transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
          zIndex: 1,
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{ width: "100%", height: "100%", background: "#1a4a2a" }}
          />
        )}
      </div>
      <div
        style={{
          color: "rgba(0,255,180,0.7)",
          fontSize: 13,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          opacity,
          transition: "opacity 0.5s ease 0.2s",
          zIndex: 1,
        }}
      >
        entering {name}
      </div>
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function compactLoadingLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "bungalow";
  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) {
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }
  return trimmed.replace(/[-_]+/g, " ");
}

function BungalowLoadingState({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <section className={styles.mainColumn}>
          <div className={styles.wallRegion}>
            <BungalowEntryTransition name={name} imageUrl={imageUrl} />
          </div>
        </section>
      </div>
    </div>
  );
}

interface BungalowPageLocationState {
  pendingBodegaItem?: unknown;
}

export default function BungalowPage() {
  const {
    chain: routeChain,
    ca: routeCa,
    identifier: routeIdentifier,
  } = useParams<{
    chain?: string;
    ca?: string;
    identifier?: string;
  }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState =
    (location.state as BungalowPageLocationState | null) ?? null;
  const pendingBodegaItem = normalizeBodegaCatalogItem(
    locationState?.pendingBodegaItem,
  );
  const preferredResolveChain = (searchParams.get("chain") ?? "")
    .trim()
    .toLowerCase();
  const hasDirectRoute = Boolean(routeChain && routeCa);
  const {
    target: resolvedTarget,
    isLoading: resolveLoading,
    error: resolveError,
  } = useBungalowResolver(
    hasDirectRoute ? undefined : routeIdentifier,
    hasDirectRoute ? undefined : preferredResolveChain || undefined,
  );
  const chain = hasDirectRoute
    ? (routeChain ?? "")
    : (resolvedTarget?.chain ?? "");
  const ca = hasDirectRoute
    ? (routeCa ?? "")
    : (resolvedTarget?.token_address ?? "");
  const { bungalow, isLoading, error } = useBungalow(
    chain || undefined,
    ca || undefined,
  );
  const loadingName = compactLoadingLabel(
    routeIdentifier ?? bungalow?.canonical_project?.symbol ?? bungalow?.symbol ?? ca,
  );

  if (!hasDirectRoute && !routeIdentifier) {
    return <div className={styles.page}>Invalid bungalow route</div>;
  }

  if (!hasDirectRoute && resolveLoading) {
    return <BungalowLoadingState name={loadingName} />;
  }

  if (!hasDirectRoute && resolveError) {
    if (resolveError.includes("(404)")) {
      return <NotFoundPage />;
    }

    return (
      <div className={styles.page}>
        Failed to resolve bungalow: {resolveError}
      </div>
    );
  }

  if (!hasDirectRoute && !resolvedTarget) {
    return <NotFoundPage />;
  }

  if (!chain || !ca || isLoading) {
    return (
      <BungalowLoadingState
        name={loadingName}
        imageUrl={bungalow?.image_url ?? undefined}
      />
    );
  }

  if (error || !bungalow) {
    return (
      <div className={styles.page}>
        Failed to load bungalow: {error ?? "Unknown"}
      </div>
    );
  }

  if (!bungalow.exists) {
    return <NotFoundPage />;
  }

  const assets = bungalow.assets?.length
    ? bungalow.assets
    : [buildFallbackAsset(bungalow)];
  const activeAsset =
    bungalow.active_asset ??
    assets.find((asset) => asset.is_active) ??
    assets[0];
  const deployments = activeAsset.deployments;
  const activeDeployment =
    bungalow.active_deployment ??
    deployments.find((deployment) => deployment.is_active) ??
    deployments[0];
  const canonicalProject = bungalow.canonical_project;
  const displayName =
    canonicalProject?.name ?? bungalow.name ?? "Unknown Token";
  const displaySymbol = canonicalProject?.symbol ?? null;
  const activeChain = activeDeployment.chain || bungalow.chain || chain;
  const headerImage = getTokenImageUrl(
    bungalow.image_url,
    activeDeployment.token_address,
    activeAsset.symbol ?? bungalow.symbol,
  );
  const adminAddress = getVerifiedAdminAddress(bungalow);
  const visibleChains = [
    ...new Set(
      assets.flatMap((asset) =>
        asset.deployments.map((deployment) => deployment.chain),
      ),
    ),
  ];
  const currentBodegaTarget = {
    chain: activeChain,
    token_address: activeDeployment.token_address,
    name: displayName,
    symbol: displaySymbol ?? activeAsset.symbol ?? bungalow.symbol ?? null,
    image_url: bungalow.image_url ?? null,
  };

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <section className={styles.mainColumn}>
          <div className={styles.wallRegion}>
            <Suspense
              fallback={
                <BungalowEntryTransition
                  name={bungalow?.name ?? ""}
                  imageUrl={bungalow?.image_url ?? undefined}
                />
              }
            >
              <BungalowScene
                chain={chain}
                ca={ca}
                ownerAddress={bungalow.current_owner}
                adminAddress={adminAddress}
                title={displayName}
                symbol={
                  displaySymbol ?? activeAsset.symbol ?? bungalow.symbol ?? null
                }
                imageUrl={headerImage}
                description={bungalow.description}
                visibleChains={visibleChains}
                initialBodegaItem={pendingBodegaItem}
                onInitialBodegaItemConsumed={() => {
                  navigate(`${location.pathname}${location.search}`, {
                    replace: true,
                    state: null,
                  });
                }}
                onOpenBodega={() =>
                  navigate("/bodega", {
                    state: {
                      preselectedBungalow: currentBodegaTarget,
                    },
                  })
                }
              />
            </Suspense>
          </div>
        </section>

        <div className={styles.sideColumn}>
          <div className={styles.deploymentList}>
            {assets.map((asset) => (
              <section
                key={asset.id}
                className={`${styles.assetCard} ${
                  asset.is_active ? styles.assetCardActive : ""
                }`}
              >
                <div className={styles.assetHeader}>
                  <div>
                    <p className={styles.assetEyebrow}>
                      {asset.kind === "nft_collection"
                        ? "NFT Collection"
                        : "Token"}
                    </p>
                    <h2 className={styles.assetTitle}>
                      {asset.symbol ? (
                        <span className={styles.assetTicker}>
                          ${asset.symbol}
                        </span>
                      ) : null}
                    </h2>
                  </div>
                </div>

                <div className={styles.deploymentSublist}>
                  {asset.deployments.map((deployment) => {
                    const deploymentSymbol = deployment.symbol ?? asset.symbol;
                    const deploymentIsNft = Boolean(
                      deployment.is_nft ?? deployment.decimals === 0,
                    );

                    return (
                      <div
                        key={`${deployment.chain}:${deployment.token_address}`}
                        className={styles.deploymentStack}
                      >
                        <section
                          className={`${styles.deploymentCard} ${
                            deployment.is_active
                              ? styles.deploymentCardActive
                              : ""
                          }`}
                        >
                          <div className={styles.deploymentHeader}>
                            <div className={styles.deploymentTitle}>
                              <ChainIcon
                                chain={deployment.chain}
                                className={styles.deploymentChainIcon}
                                size={14}
                              />
                              <strong>{getChainLabel(deployment.chain)}</strong>
                              <span className={styles.deploymentTicker}>
                                {deploymentSymbol
                                  ? `$${deploymentSymbol}`
                                  : "?"}
                              </span>
                            </div>
                          </div>

                          <div className={styles.deploymentMeta}>
                            <span
                              className={`${styles.chainBadge} ${chainToneClass(deployment.chain)}`}
                            >
                              {tokenStandardLabel(
                                deployment.chain,
                                deploymentIsNft,
                              )}
                            </span>
                          </div>

                          <p className={styles.deploymentAddress}>
                            {deployment.token_address}
                          </p>

                          <div className={styles.deploymentStats}>
                            <div>
                              <span>Holders</span>
                              <strong>
                                {formatNumber(deployment.holder_count)}
                              </strong>
                            </div>
                            <div>
                              <span>Avg Heat</span>
                              <strong>
                                {formatHeatMetric(
                                  deployment.heat_stats?.top_50_average ?? null,
                                  deployment.heat_stats?.sample_size,
                                )}
                              </strong>
                            </div>
                          </div>
                        </section>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
