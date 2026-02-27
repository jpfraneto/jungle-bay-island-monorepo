import { useState } from "react";
import { useParams } from "react-router-dom";
import AddItemModal from "../components/AddItemModal";
import ClaimPanel from "../components/ClaimPanel";
import Wall from "../components/Wall";
import { useBungalow } from "../hooks/useBungalow";
import { useBungalowItems } from "../hooks/useBungalowItems";
import NotFoundPage from "./NotFoundPage";
import { formatCompactUsd, formatNumber } from "../utils/formatters";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bungalow-page.module.css";

function chainLabel(chain: string): string {
  if (chain === "base") return "Base";
  if (chain === "ethereum") return "Ethereum";
  return "Solana";
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

function ChainIcon({ chain }: { chain: string }) {
  if (chain === "ethereum") {
    return (
      <svg viewBox="0 0 24 24" className={styles.chainIcon} aria-hidden="true">
        <path
          d="M12 2.3 6.7 12l5.3 3.2 5.3-3.2L12 2.3Zm-5.3 11.7L12 21.7l5.3-7.7L12 17.2 6.7 14Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (chain === "solana") {
    return (
      <svg viewBox="0 0 24 24" className={styles.chainIcon} aria-hidden="true">
        <path
          d="M5.2 5.5a1.8 1.8 0 0 1 1.3-.5h11.2c1.2 0 1.8 1.5.9 2.4l-2.2 2.2a1.8 1.8 0 0 1-1.3.5H4c-1.2 0-1.8-1.5-.9-2.4l2.1-2.2Z"
          fill="currentColor"
        />
        <path
          d="M18.8 11.8a1.8 1.8 0 0 0-1.3-.5H6.3c-1.2 0-1.8 1.5-.9 2.4l2.2 2.2c.3.3.8.5 1.3.5h11.2c1.2 0 1.8-1.5.9-2.4l-2.2-2.2Z"
          fill="currentColor"
          opacity="0.82"
        />
        <path
          d="M5.2 18.1a1.8 1.8 0 0 1 1.3-.5h11.2c1.2 0 1.8 1.5.9 2.4l-2.2 2.2a1.8 1.8 0 0 1-1.3.5H4c-1.2 0-1.8-1.5-.9-2.4l2.1-2.2Z"
          fill="currentColor"
          opacity="0.66"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={styles.chainIcon} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

function formatHeatMetric(
  value: number | null | undefined,
  sampleSize: number | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!sampleSize || sampleSize <= 0) return `${value.toFixed(2)}°`;
  return `${value.toFixed(2)}° `;
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
  const { bungalow, isLoading, error } = useBungalow(chain, ca);
  const {
    items,
    isLoading: itemsLoading,
    refetch,
  } = useBungalowItems(chain, ca);

  const [isAddOpen, setIsAddOpen] = useState(false);

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

  const headerImage = getTokenImageUrl(
    bungalow.image_url,
    bungalow.token_address,
    bungalow.symbol,
  );
  const activeChain = bungalow.chain || chain;
  const isNft = Boolean(bungalow.is_nft ?? bungalow.decimals === 0);

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <section className={styles.mainColumn}>
          <header className={styles.headerCard}>
            <div className={styles.headerTop}>
              <img
                className={styles.tokenImage}
                src={headerImage}
                alt={bungalow.symbol ?? "token"}
                onError={(event) => {
                  event.currentTarget.src = getFallbackTokenImage(
                    `${bungalow.chain}:${bungalow.token_address}`,
                  );
                }}
              />

              <div className={styles.headerText}>
                <div className={styles.titleRow}>
                  <ChainIcon chain={activeChain} />
                  <h1 className={styles.title}>
                    {bungalow.name ?? "Unknown Token"} (
                    {bungalow.symbol ? `$${bungalow.symbol}` : "?"})
                  </h1>
                </div>
                <div className={styles.headerMeta}>
                  <div className={`${styles.chainBadge} ${chainToneClass(activeChain)}`}>
                    {chainLabel(activeChain)}
                  </div>
                  <div className={styles.standardBadge}>
                    {tokenStandardLabel(activeChain, isNft)}
                  </div>
                </div>
                <p className={styles.contractAddress}>{bungalow.token_address}</p>
              </div>
            </div>

            <div className={styles.stats}>
              <div>
                <span>Holders</span>
                <strong>{formatNumber(bungalow.holder_count)}</strong>
              </div>

              <div>
                <span>Market Cap</span>
                <strong>
                  {formatCompactUsd(bungalow.market_data?.market_cap ?? null)}
                </strong>
              </div>

              <div>
                <span>Avg Heat (Top 50)</span>
                <strong>
                  {formatHeatMetric(
                    bungalow.heat_stats?.top_50_average ?? null,
                    bungalow.heat_stats?.sample_size,
                  )}
                </strong>
              </div>

              <div>
                <span>Heat Std Dev (Top 50)</span>
                <strong>
                  {formatHeatMetric(
                    bungalow.heat_stats?.top_50_stddev ?? null,
                    bungalow.heat_stats?.sample_size,
                  )}
                </strong>
              </div>
            </div>
          </header>

          <Wall
            items={items}
            isLoading={itemsLoading}
            onAdd={() => setIsAddOpen(true)}
          />
        </section>

        <div className={styles.sideColumn}>
          <ClaimPanel
            chain={chain}
            ca={ca}
            tokenSymbol={bungalow.symbol ?? "TOKEN"}
          />
        </div>
      </div>

      <AddItemModal
        chain={chain}
        ca={ca}
        open={isAddOpen}
        symbol={bungalow.symbol ?? ""}
        onClose={() => setIsAddOpen(false)}
        onCreated={() => {
          void refetch();
        }}
      />
    </div>
  );
}
