import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate, useParams } from "react-router-dom";
import AddItemModal from "../components/AddItemModal";
import BodegaCard from "../components/BodegaCard";
import ChainIcon, { getChainLabel } from "../components/ChainIcon";
import Wall from "../components/Wall";
import {
  useBungalow,
  type BungalowAsset,
  type BungalowDeployment,
  type BungalowDetails,
} from "../hooks/useBungalow";
import { useBungalowDirectory } from "../hooks/useBungalowDirectory";
import { useBungalowItems } from "../hooks/useBungalowItems";
import { useBungalowResolver } from "../hooks/useBungalowResolver";
import NotFoundPage from "./NotFoundPage";
import { formatCompactUsd, formatNumber } from "../utils/formatters";
import {
  getBungalowLookupKey,
  normalizeBodegaInstallRecords,
  type BodegaInstallRecord,
  type DirectoryBungalow,
} from "../utils/bodega";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bungalow-page.module.css";

interface BodegaInstallsResponse {
  installs?: unknown[];
  error?: unknown;
}

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

function BungalowSkeleton() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <section className={styles.mainColumn}>
          <div className={styles.skeletonHeaderCard}>
            <div className={styles.headerTop}>
              <div
                className={`${styles.skeletonBlock} ${styles.skeletonTokenImage}`}
              />

              <div className={styles.skeletonHeaderText}>
                <div
                  className={`${styles.skeletonBlock} ${styles.skeletonTitle}`}
                />
                <div
                  className={`${styles.skeletonBlock} ${styles.skeletonBadge}`}
                />
              </div>
            </div>

            <div className={styles.stats}>
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={`stats-skeleton-${idx}`}
                  className={styles.skeletonStatCard}
                >
                  <div
                    className={`${styles.skeletonBlock} ${styles.skeletonLabel}`}
                  />
                  <div
                    className={`${styles.skeletonBlock} ${styles.skeletonValue}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.skeletonWallCard}>
            <div
              className={`${styles.skeletonBlock} ${styles.skeletonWallHeader}`}
            />
            <div className={styles.skeletonWallGrid}>
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={`wall-skeleton-${idx}`}
                  className={styles.skeletonWallItem}
                >
                  <div
                    className={`${styles.skeletonBlock} ${styles.skeletonWallLineLong}`}
                  />
                  <div
                    className={`${styles.skeletonBlock} ${styles.skeletonWallLineShort}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className={styles.sideColumn}>
          <div className={styles.skeletonClaimCard}>
            <div
              className={`${styles.skeletonBlock} ${styles.skeletonClaimTitle}`}
            />
            <div
              className={`${styles.skeletonBlock} ${styles.skeletonClaimMetric}`}
            />
            <div
              className={`${styles.skeletonBlock} ${styles.skeletonClaimMetric}`}
            />
            <div
              className={`${styles.skeletonBlock} ${styles.skeletonClaimButton}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
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
  const navigate = useNavigate();
  const { authenticated, login } = usePrivy();
  const hasDirectRoute = Boolean(routeChain && routeCa);
  const {
    target: resolvedTarget,
    isLoading: resolveLoading,
    error: resolveError,
  } = useBungalowResolver(hasDirectRoute ? undefined : routeIdentifier);
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
  const {
    items,
    isLoading: itemsLoading,
    refetch,
  } = useBungalowItems(chain, ca);
  const { bungalows: directoryBungalows } = useBungalowDirectory({
    limit: 200,
  });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [bodegaInstalls, setBodegaInstalls] = useState<BodegaInstallRecord[]>(
    [],
  );
  const [isBodegaInstallsLoading, setIsBodegaInstallsLoading] = useState(false);
  const [bodegaInstallsError, setBodegaInstallsError] = useState<string | null>(
    null,
  );
  const originLookup = useMemo(() => {
    const lookup = new Map<string, DirectoryBungalow>();
    for (const bungalowOption of directoryBungalows) {
      const key = getBungalowLookupKey(
        bungalowOption.chain,
        bungalowOption.token_address,
      );
      if (key) {
        lookup.set(key, bungalowOption);
      }
    }
    return lookup;
  }, [directoryBungalows]);

  const installLookupChain = bungalow?.active_deployment?.chain ?? chain;
  const installLookupToken = bungalow?.active_deployment?.token_address ?? ca;

  useEffect(() => {
    if (!installLookupChain || !installLookupToken) {
      setBodegaInstalls([]);
      setIsBodegaInstallsLoading(false);
      setBodegaInstallsError(null);
      return;
    }

    const controller = new AbortController();
    setIsBodegaInstallsLoading(true);
    setBodegaInstallsError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/bodega/installs/${encodeURIComponent(installLookupChain)}/${encodeURIComponent(installLookupToken)}`,
          {
            signal: controller.signal,
          },
        );

        const data = (await response
          .json()
          .catch(() => null)) as BodegaInstallsResponse | null;

        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;

        if (!response.ok) {
          throw new Error(apiError ?? `Request failed (${response.status})`);
        }

        setBodegaInstalls(normalizeBodegaInstallRecords(data?.installs));
      } catch (err) {
        if (controller.signal.aborted) return;
        setBodegaInstalls([]);
        setBodegaInstallsError(
          err instanceof Error
            ? err.message
            : "Failed to load installed Bodega items",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsBodegaInstallsLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [installLookupChain, installLookupToken]);

  const handleOpenAddModal = () => {
    if (!authenticated) {
      login();
      return;
    }
    setIsAddOpen(true);
  };

  if (!hasDirectRoute && !routeIdentifier) {
    return <div className={styles.page}>Invalid bungalow route</div>;
  }

  if (!hasDirectRoute && resolveLoading) {
    return <BungalowSkeleton />;
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
    return <BungalowSkeleton />;
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
  const aggregateHolderCount =
    canonicalProject?.total_holder_count ?? bungalow.holder_count;
  const assetCount = canonicalProject?.asset_count ?? assets.length;
  const chainCount =
    canonicalProject?.chain_count ??
    new Set(
      assets.flatMap((asset) =>
        asset.deployments.map((deployment) => deployment.chain),
      ),
    ).size;
  const deploymentCount =
    canonicalProject?.deployment_count ??
    assets.reduce((sum, asset) => sum + asset.deployment_count, 0);
  const visibleChains = [
    ...new Set(
      assets.flatMap((asset) =>
        asset.deployments.map((deployment) => deployment.chain),
      ),
    ),
  ];
  const currentBodegaTarget: DirectoryBungalow = {
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
          <header className={styles.headerCard}>
            <div className={styles.headerTop}>
              <img
                className={styles.tokenImage}
                src={headerImage}
                alt={displaySymbol ?? "token"}
                onError={(event) => {
                  event.currentTarget.src = getFallbackTokenImage(
                    `${activeDeployment.chain}:${activeDeployment.token_address}`,
                  );
                }}
              />

              <div className={styles.headerText}>
                <div className={styles.titleRow}>
                  <h1 className={styles.title}>{displayName}</h1>
                </div>
                <div className={styles.headerMeta}>
                  {visibleChains.map((deploymentChain) => (
                    <div
                      key={deploymentChain}
                      className={`${styles.chainBadge} ${chainToneClass(deploymentChain)}`}
                    >
                      {getChainLabel(deploymentChain)}
                    </div>
                  ))}
                </div>

                {assetCount > 1 || deploymentCount > 1 ? (
                  <p className={styles.identityNote}>
                    This bungalow groups {assetCount} official assets across{" "}
                    {deploymentCount} deployments.
                  </p>
                ) : null}
                {bungalow.description ? (
                  <p className={styles.description}>{bungalow.description}</p>
                ) : null}
              </div>
            </div>

            <div className={styles.stats}>
              <div>
                <span>Tracked Holders</span>
                <strong>{formatNumber(aggregateHolderCount)}</strong>
              </div>

              <div>
                <span>Assets</span>
                <strong>{formatNumber(assetCount)}</strong>
              </div>

              <div>
                <span>Deployments</span>
                <strong>{formatNumber(deploymentCount)}</strong>
              </div>

              <div>
                <span>Chains</span>
                <strong>{formatNumber(chainCount)}</strong>
              </div>
            </div>
          </header>

          <div className={styles.wallRegion}>
            <section className={styles.marketStrip}>
              <div className={styles.marketCopy}>
                <p>Island Bodega</p>
                <strong>
                  Bring creator-made tools and decor into this bungalow.
                </strong>
              </div>
              <button
                type="button"
                className={styles.marketButton}
                onClick={() =>
                  navigate("/bodega", {
                    state: {
                      preselectedBungalow: currentBodegaTarget,
                    },
                  })
                }
              >
                Shop the Bodega
              </button>
            </section>

            <Wall
              items={items}
              isLoading={itemsLoading}
              onAdd={handleOpenAddModal}
            />

            <section className={styles.bodegaShelf}>
              <div className={styles.sectionHeading}>
                <div>
                  <p>Installed from the Bodega</p>
                  <strong>
                    Marketplace items already living in this bungalow.
                  </strong>
                </div>
              </div>

              {isBodegaInstallsLoading ? (
                <div className={styles.shelfStatus}>
                  Loading installed Bodega items...
                </div>
              ) : bodegaInstallsError ? (
                <div className={styles.shelfStatus}>
                  Failed to load Bodega installs: {bodegaInstallsError}
                </div>
              ) : bodegaInstalls.filter((install) => install.catalog_item)
                  .length === 0 ? (
                <div className={styles.shelfStatus}>
                  No Bodega items are installed here yet.
                </div>
              ) : (
                <div className={styles.installedGrid}>
                  {bodegaInstalls.map((install) => {
                    if (!install.catalog_item) return null;

                    const originKey = getBungalowLookupKey(
                      install.catalog_item.origin_bungalow_chain,
                      install.catalog_item.origin_bungalow_token_address,
                    );

                    return (
                      <BodegaCard
                        key={install.id}
                        item={install.catalog_item}
                        originBungalow={
                          originKey
                            ? (originLookup.get(originKey) ?? null)
                            : null
                        }
                        actionLabel="From Bodega"
                      />
                    );
                  })}
                </div>
              )}
            </section>
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
                      {asset.name}
                      {asset.symbol ? (
                        <span className={styles.assetTicker}>
                          ${asset.symbol}
                        </span>
                      ) : null}
                    </h2>
                  </div>

                  <div className={styles.deploymentBadges}>
                    {asset.is_primary ? (
                      <span className={styles.deploymentPill}>
                        Primary Asset
                      </span>
                    ) : null}
                    {asset.is_active ? (
                      <span
                        className={`${styles.deploymentPill} ${styles.deploymentPillActive}`}
                      >
                        Open Asset
                      </span>
                    ) : null}
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

                            <div className={styles.deploymentBadges}>
                              {deployment.is_primary ? (
                                <span className={styles.deploymentPill}>
                                  Primary
                                </span>
                              ) : null}
                              {deployment.is_active ? (
                                <span
                                  className={`${styles.deploymentPill} ${styles.deploymentPillActive}`}
                                >
                                  Open
                                </span>
                              ) : null}
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
                              <span>Market Cap</span>
                              <strong>
                                {formatCompactUsd(
                                  deployment.market_data?.market_cap ?? null,
                                )}
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

      <AddItemModal
        chain={chain}
        ca={ca}
        open={isAddOpen}
        symbol={activeAsset.symbol ?? bungalow.symbol ?? ""}
        onClose={() => setIsAddOpen(false)}
        onCreated={() => {
          void refetch();
        }}
      />
    </div>
  );
}
