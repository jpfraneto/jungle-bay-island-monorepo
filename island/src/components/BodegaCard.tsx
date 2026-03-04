import { formatJbmAmount } from "../utils/formatters";
import {
  formatCreatorLabel,
  getBodegaAssetIcon,
  getBodegaAssetGroupLabel,
  getBodegaPreviewUrl,
  getBodegaSummaryText,
  type BodegaCatalogItem,
  type DirectoryBungalow,
} from "../utils/bodega";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bodega-card.module.css";

interface BodegaCardProps {
  item: BodegaCatalogItem;
  originBungalow?: DirectoryBungalow | null;
  onAdd?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  domId?: string;
  highlighted?: boolean;
  compact?: boolean;
}

export default function BodegaCard({
  item,
  originBungalow = null,
  onAdd,
  actionLabel = "Add to Bungalow",
  actionDisabled = false,
  domId,
  highlighted = false,
  compact = true,
}: BodegaCardProps) {
  const previewUrl = getBodegaPreviewUrl(item);
  const summary = getBodegaSummaryText(item);
  const creatorLabel = formatCreatorLabel(item);
  const displayType = getBodegaAssetGroupLabel(item.asset_type);
  const originLabel =
    originBungalow?.name ??
    originBungalow?.symbol ??
    (item.origin_bungalow_token_address ? "Unknown Bungalow" : null);
  const compactMeta = originLabel
    ? `by ${creatorLabel} · ${originLabel}`
    : `by ${creatorLabel}`;

  return (
    <article
      id={domId}
      className={`${styles.card} ${
        compact ? styles.compactCard : styles.featureCard
      } ${highlighted ? styles.highlighted : ""}`}
    >
      <div className={styles.media}>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={item.title}
            loading="lazy"
            className={styles.preview}
          />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.assetIcon}>{getBodegaAssetIcon(item.asset_type)}</span>
            <small>{displayType}</small>
          </div>
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.topRow}>
          <span className={styles.assetType}>{displayType}</span>
          <span className={styles.installCount}>
            {item.install_count} bungalow{item.install_count === 1 ? "" : "s"}
          </span>
        </div>

        <h3 className={styles.title}>{item.title}</h3>
        {compact ? (
          <p className={styles.compactMeta}>{compactMeta}</p>
        ) : (
          <>
            <p className={styles.creator}>by {creatorLabel}</p>
            <p className={styles.summary}>{summary}</p>

            {originLabel ? (
              <div className={styles.origin}>
                {originBungalow ? (
                  <img
                    src={getTokenImageUrl(
                      originBungalow.image_url,
                      originBungalow.token_address,
                      originBungalow.symbol,
                    )}
                    alt={originBungalow.symbol ?? originLabel}
                    onError={(event) => {
                      event.currentTarget.src = getFallbackTokenImage(
                        `${originBungalow.chain}:${originBungalow.token_address}`,
                      );
                    }}
                  />
                ) : null}
                <span>From: {originLabel}</span>
              </div>
            ) : null}
          </>
        )}

        <div className={styles.footer}>
          <strong className={styles.price}>
            Install: {formatJbmAmount(item.price_in_jbm)}
          </strong>
          {onAdd ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onAdd}
              disabled={actionDisabled}
            >
              {actionLabel}
            </button>
          ) : (
            <span className={styles.statusPill}>{actionLabel}</span>
          )}
        </div>
      </div>
    </article>
  );
}
