import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
import ChainIcon from "./ChainIcon";
import { GLOW_COLORS } from "../utils/constants";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import NodeTooltip from "./NodeTooltip";
import styles from "../styles/bungalow-node.module.css";

interface BungalowNodeProps {
  bungalow: HomeTeamBungalow;
  x: number;
  y: number;
  index: number;
}

export default function BungalowNode({ bungalow, x, y, index }: BungalowNodeProps) {
  const navigate = useNavigate();
  const glowColor = GLOW_COLORS[index % GLOW_COLORS.length];
  const [isHovered, setIsHovered] = useState(false);
  const fallbackImage = getFallbackTokenImage(
    `${bungalow.chain}:${bungalow.token_address}`,
  );
  const imageSrc = getTokenImageUrl(
    bungalow.image_url,
    bungalow.token_address,
    bungalow.symbol,
  );
  const rawTicker = bungalow.symbol?.trim() || "?";
  const ticker = rawTicker.length > 12 ? `${rawTicker.slice(0, 12)}…` : rawTicker;
  const bungalowPath = `/bungalow/${bungalow.canonical_slug ?? bungalow.token_address}`;
  const imageKey = `${bungalow.chain}:${bungalow.token_address}:${bungalow.image_url ?? ""}:${bungalow.symbol ?? ""}`;

  const style = {
    left: `${x}%`,
    top: `${y}%`,
    "--glow-color": glowColor,
    "--float-delay": `${(index % 8) * 0.3}s`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={styles.node}
      style={style}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      onClick={() =>
        navigate(bungalowPath, {
          state: {
            preloadedBungalow: {
              name: bungalow.name ?? null,
              symbol: bungalow.symbol ?? null,
              imageUrl: bungalow.image_url ?? null,
            },
          },
        })
      }
    >
      <span className={styles.glow} />
      <img
        key={imageKey}
        className={styles.avatar}
        src={imageSrc}
        alt={bungalow.symbol ?? bungalow.name ?? "token"}
        loading="lazy"
        onError={(event) => {
          if (event.currentTarget.dataset.fallbackApplied === "true") return;
          event.currentTarget.dataset.fallbackApplied = "true";
          event.currentTarget.src = fallbackImage;
        }}
      />
      <span className={styles.label}>
        <ChainIcon chain={bungalow.chain} className={styles.chainIcon} size={11} />
        <span className={styles.symbol}>{ticker}</span>
      </span>
      <NodeTooltip
        name={bungalow.name}
        symbol={bungalow.symbol}
        holderCount={bungalow.holder_count ?? 0}
        visible={isHovered}
      />
    </button>
  );
}
