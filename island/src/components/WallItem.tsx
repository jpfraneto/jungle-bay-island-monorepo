import { useNavigate } from "react-router-dom";
import type { BungalowItem } from "../hooks/useBungalowItems";
import { formatAddress, formatJbmAmount, formatTimeAgo } from "../utils/formatters";
import styles from "../styles/wall-item.module.css";

interface WallItemProps {
  item: BungalowItem;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function WallItem({ item }: WallItemProps) {
  const navigate = useNavigate();
  const title = asString(item.content.title);
  const url = asString(item.content.url);
  const text = asString(item.content.text);
  const imageUrl = asString(item.content.image_url || item.content.url);
  const caption = asString(item.content.caption);
  const portalChain = asString(item.content.target_chain || item.content.chain);
  const portalCa = asString(item.content.target_ca || item.content.ca);
  const portalName = asString(item.content.target_name || item.content.name || item.content.symbol);

  return (
    <article className={styles.card}>
      <div className={styles.type}>{item.item_type}</div>

      {item.item_type === "link" ? (
        <a href={url} target="_blank" rel="noreferrer" className={styles.bodyLink}>
          <div className={styles.mainText}>🔗 {title || "Untitled link"}</div>
          <div className={styles.subText}>{url}</div>
        </a>
      ) : null}

      {item.item_type === "frame" ? (
        <div className={styles.bodyText}>
          <div className={styles.mainText}>📝 Frame</div>
          <p className={styles.frameText}>{text.slice(0, 280)}</p>
        </div>
      ) : null}

      {item.item_type === "image" ? (
        <div className={styles.bodyText}>
          <div className={styles.mainText}>🖼️ Image</div>
          {imageUrl ? <img className={styles.image} src={imageUrl} alt={caption || "Wall image"} /> : null}
          {caption ? <p className={styles.subText}>{caption}</p> : null}
        </div>
      ) : null}

      {item.item_type === "portal" ? (
        <button
          type="button"
          className={styles.portalButton}
          onClick={() => {
            if (portalChain && portalCa) {
              navigate(`/${portalChain}/${portalCa}`);
            }
          }}
        >
          <div className={styles.mainText}>🌀 Portal</div>
          <div className={styles.subText}>{portalName || "Jump to destination"}</div>
        </button>
      ) : null}

      <footer className={styles.footer}>
        <span>{formatAddress(item.placed_by)}</span>
        <span>{formatTimeAgo(item.created_at)}</span>
      </footer>

      <div className={styles.badge}>{formatJbmAmount(item.jbm_amount)}</div>
    </article>
  );
}
