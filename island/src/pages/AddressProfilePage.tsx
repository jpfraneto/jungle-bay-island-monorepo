import { Link, useParams } from "react-router-dom";
import {
  useAddressProfile,
  type AddressContributionItem,
} from "../hooks/useAddressProfile";
import {
  formatAddress,
  formatJbmAmount,
  formatNumber,
  formatTimeAgo,
} from "../utils/formatters";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/address-profile-page.module.css";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatHeat(value: number | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0°";
  if (Math.abs(numeric) < 0.05) return "0°";
  return `${numeric.toFixed(1)}°`;
}

function chainLabel(chain: string): string {
  if (chain === "base") return "Base";
  if (chain === "ethereum") return "Ethereum";
  if (chain === "solana") return "Solana";
  return chain;
}

function renderItemContent(item: AddressContributionItem) {
  const title = asString(item.content.title);
  const url = asString(item.content.url);
  const text = asString(item.content.text);
  const imageUrl = asString(item.content.image_url || item.content.url);
  const caption = asString(item.content.caption);
  const targetName = asString(
    item.content.target_name || item.content.name || item.content.symbol,
  );
  const targetChain = asString(item.content.target_chain || item.content.chain);
  const targetCa = asString(item.content.target_ca || item.content.ca);

  if (item.item_type === "link") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={styles.linkBody}
      >
        <strong>{title || "Untitled link"}</strong>
        <span>{url}</span>
      </a>
    );
  }

  if (item.item_type === "frame") {
    return <p className={styles.frameBody}>{text || "No frame text"}</p>;
  }

  if (item.item_type === "image") {
    return (
      <div className={styles.imageBody}>
        {imageUrl ? (
          <img src={imageUrl} alt={caption || "Posted image"} />
        ) : null}
        {caption ? <span>{caption}</span> : null}
      </div>
    );
  }

  const portalTo =
    targetChain && targetCa ? `/${targetChain}/${targetCa}` : undefined;
  return (
    <div className={styles.portalBody}>
      <span>{targetName || "Portal destination"}</span>
      {portalTo ? <Link to={portalTo}>Open destination bungalow</Link> : null}
    </div>
  );
}

function renderMetadata(item: AddressContributionItem) {
  const entries = Object.entries(item.content).filter(([, value]) => {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  });

  if (entries.length === 0) return null;

  return (
    <div className={styles.metadataList}>
      {entries.map(([key, value]) => (
        <span key={`${item.id}-${key}`} className={styles.metadataPill}>
          {key}: {String(value)}
        </span>
      ))}
    </div>
  );
}

function AddressProfileSkeleton() {
  return (
    <div className={styles.page}>
      <section className={`${styles.headerCard} ${styles.skeletonCard}`}>
        <div className={styles.skeletonBlockGroup}>
          <div className={`${styles.skeletonBlock} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeletonBlock} ${styles.skeletonWallet}`} />
        </div>
        <div className={styles.skeletonStats}>
          <div className={styles.skeletonStat}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonValue}`} />
          </div>
          <div className={styles.skeletonStat}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonValue}`} />
          </div>
          <div className={styles.skeletonStat}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonValue}`} />
          </div>
        </div>
      </section>

      <section className={styles.board}>
        {Array.from({ length: 6 }).map((_, index) => (
          <article key={`skeleton-${index}`} className={styles.skeletonPinCard}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonCardTop}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonCardLine}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonCardLineShort}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonCardMedia}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonCardFooter}`} />
          </article>
        ))}
      </section>
    </div>
  );
}

export default function AddressProfilePage() {
  const { wallet_address = "" } = useParams();
  const normalizedWallet = wallet_address.trim();
  const { profile, items, total, isLoading, error } =
    useAddressProfile(normalizedWallet);

  if (!normalizedWallet) {
    return <div className={styles.page}>Invalid wallet address</div>;
  }

  if (isLoading) {
    return <AddressProfileSkeleton />;
  }

  if (error) {
    return <div className={styles.page}>Failed to load profile: {error}</div>;
  }

  const displayName =
    profile?.farcaster?.display_name ??
    profile?.farcaster?.username ??
    formatAddress(normalizedWallet);
  const islandHeat = profile?.island_heat ?? 0;
  const tier = profile?.tier ?? "drifter";

  return (
    <div className={styles.page}>
      <section className={styles.headerCard}>
        <div>
          <h1>{displayName}</h1>
          <div className={styles.walletBadge}>{normalizedWallet}</div>
        </div>

        <div className={styles.headerStats}>
          <div>
            <span>Island Heat</span>
            <strong>{islandHeat.toFixed(1)}°</strong>
          </div>
          <div>
            <span>Tier</span>
            <strong>{tier}</strong>
          </div>
          <div>
            <span>Elements Added</span>
            <strong>{formatNumber(total)}</strong>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <section className={styles.empty}>
          This wallet has not added any wall elements yet.
        </section>
      ) : (
        <section className={styles.board}>
          {items.map((item, index) => {
            const collageClass = [
              styles.cardA,
              styles.cardB,
              styles.cardC,
              styles.cardD,
              styles.cardE,
            ][index % 5];
            const bungalowPath = `/${item.chain}/${item.token_address}`;
            const imageUrl = getTokenImageUrl(
              item.bungalow_image_url,
              item.token_address,
              item.bungalow_symbol,
            );

            return (
              <article
                key={item.id}
                className={`${styles.pinCard} ${collageClass}`}
              >
                <header className={styles.cardHeader}>
                  <Link to={bungalowPath} className={styles.bungalowLink}>
                    <img
                      src={imageUrl}
                      alt={item.bungalow_symbol ?? "bungalow"}
                      onError={(event) => {
                        event.currentTarget.src = getFallbackTokenImage(
                          `${item.chain}:${item.token_address}`,
                        );
                      }}
                    />
                    <div>
                      <strong>
                        {item.bungalow_name ??
                          item.bungalow_symbol ??
                          "Unknown Bungalow"}
                      </strong>
                      <span>{chainLabel(item.chain)}</span>
                    </div>
                  </Link>
                  <span className={styles.typeTag}>{item.item_type}</span>
                </header>

                <div className={styles.metricRow}>
                  <span className={styles.jbmTag}>
                    {formatJbmAmount(item.jbm_amount)}
                  </span>
                  <span className={styles.heatTag}>
                    Heat {formatHeat(item.placed_by_heat_degrees)}
                  </span>
                </div>

                <div className={styles.contentBlock}>
                  {renderItemContent(item)}
                </div>
                {renderMetadata(item)}

                <footer className={styles.cardFooter}>
                  <span>{formatTimeAgo(item.created_at)}</span>
                  <span>
                    tx:{" "}
                    <a
                      href={`https://basescan.org/tx/${item.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {formatAddress(item.tx_hash)}
                    </a>
                  </span>
                </footer>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
