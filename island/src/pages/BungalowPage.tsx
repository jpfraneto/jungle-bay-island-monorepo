import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate, useParams } from "react-router-dom";
import AddItemModal from "../components/AddItemModal";
import ChainIcon, { getChainLabel } from "../components/ChainIcon";
import ClaimPanel from "../components/ClaimPanel";
import Wall from "../components/Wall";
import {
  useBungalow,
  type BungalowDeployment,
  type BungalowDetails,
} from "../hooks/useBungalow";
import { useBungalowItems } from "../hooks/useBungalowItems";
import NotFoundPage from "./NotFoundPage";
import { formatCompactUsd, formatNumber } from "../utils/formatters";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bungalow-page.module.css";

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

function buildFallbackDeployment(bungalow: BungalowDetails): BungalowDeployment {
  return {
    chain: bungalow.chain,
    token_address: bungalow.token_address,
    route_path: `/${bungalow.chain}/${bungalow.token_address}`,
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
  const { chain = "", ca = "" } = useParams();
  const navigate = useNavigate();
  const { authenticated, login } = usePrivy();
  const { bungalow, isLoading, error } = useBungalow(chain, ca);
  const {
    items,
    isLoading: itemsLoading,
    refetch,
  } = useBungalowItems(chain, ca);

  const [isAddOpen, setIsAddOpen] = useState(false);

  const handleOpenAddModal = () => {
    if (!authenticated) {
      login();
      return;
    }
    setIsAddOpen(true);
  };

  if (!chain || !ca) {
    return <div className={styles.page}>Invalid bungalow route</div>;
  }

  if (isLoading) {
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

  const deployments = bungalow.deployments?.length
    ? bungalow.deployments
    : [buildFallbackDeployment(bungalow)];
  const activeDeployment =
    bungalow.active_deployment ??
    deployments.find((deployment) => deployment.is_active) ??
    deployments[0];
  const canonicalProject = bungalow.canonical_project;
  const displayName = canonicalProject?.name ?? bungalow.name ?? "Unknown Token";
  const displaySymbol = canonicalProject?.symbol ?? bungalow.symbol ?? null;
  const activeChain = activeDeployment.chain || bungalow.chain || chain;
  const headerImage = getTokenImageUrl(
    bungalow.image_url,
    activeDeployment.token_address,
    displaySymbol,
  );
  const aggregateHolderCount =
    canonicalProject?.total_holder_count ?? bungalow.holder_count;
  const chainCount =
    canonicalProject?.chain_count ??
    new Set(deployments.map((deployment) => deployment.chain)).size;
  const deploymentCount =
    canonicalProject?.deployment_count ?? deployments.length;
  const visibleChains = [...new Set(deployments.map((deployment) => deployment.chain))];

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
                  <h1 className={styles.title}>
                    {displayName} ({displaySymbol ? `$${displaySymbol}` : "?"})
                  </h1>
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
                <p className={styles.contractAddress}>
                  Active entry: {getChainLabel(activeChain)} · {activeDeployment.token_address}
                </p>
                {deploymentCount > 1 ? (
                  <p className={styles.identityNote}>
                    This bungalow aggregates {deploymentCount} linked deployments.
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
                <span>Deployments</span>
                <strong>{formatNumber(deploymentCount)}</strong>
              </div>

              <div>
                <span>Chains</span>
                <strong>{formatNumber(chainCount)}</strong>
              </div>

              <div>
                <span>Open Route</span>
                <strong>{getChainLabel(activeChain)}</strong>
              </div>
            </div>
          </header>

          <div className={styles.wallRegion}>
            <Wall
              items={items}
              isLoading={itemsLoading}
              onAdd={handleOpenAddModal}
            />
          </div>
        </section>

        <div className={styles.sideColumn}>
          <div className={styles.deploymentList}>
            {deployments.map((deployment) => {
              const deploymentSymbol = deployment.symbol ?? displaySymbol;
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
                      deployment.is_active ? styles.deploymentCardActive : ""
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
                          {deploymentSymbol ? `$${deploymentSymbol}` : "?"}
                        </span>
                      </div>

                      <div className={styles.deploymentBadges}>
                        {deployment.is_primary ? (
                          <span className={styles.deploymentPill}>Primary</span>
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
                      <span className={`${styles.chainBadge} ${chainToneClass(deployment.chain)}`}>
                        {tokenStandardLabel(deployment.chain, deploymentIsNft)}
                      </span>
                    </div>

                    <p className={styles.deploymentAddress}>
                      {deployment.token_address}
                    </p>

                    <div className={styles.deploymentStats}>
                      <div>
                        <span>Holders</span>
                        <strong>{formatNumber(deployment.holder_count)}</strong>
                      </div>
                      <div>
                        <span>Market Cap</span>
                        <strong>
                          {formatCompactUsd(deployment.market_data?.market_cap ?? null)}
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

                    {!deployment.is_active ? (
                      <button
                        type="button"
                        className={styles.switchButton}
                        onClick={() => navigate(deployment.route_path)}
                      >
                        Open {getChainLabel(deployment.chain)}
                      </button>
                    ) : null}
                  </section>

                  {deployment.exists ? (
                    <ClaimPanel
                      chain={deployment.chain}
                      ca={deployment.token_address}
                      tokenSymbol={deploymentSymbol ?? "TOKEN"}
                      sticky={false}
                    />
                  ) : (
                    <div className={styles.deploymentNote}>
                      This deployment has not been scanned yet.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AddItemModal
        chain={chain}
        ca={ca}
        open={isAddOpen}
        symbol={displaySymbol ?? ""}
        onClose={() => setIsAddOpen(false)}
        onCreated={() => {
          void refetch();
        }}
      />
    </div>
  );
}
