import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
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
  const [imageSrc, setImageSrc] = useState(
    getTokenImageUrl(bungalow.image_url, bungalow.token_address, bungalow.symbol),
  );

  useEffect(() => {
    setImageSrc(getTokenImageUrl(bungalow.image_url, bungalow.token_address, bungalow.symbol));
  }, [bungalow.image_url, bungalow.token_address, bungalow.symbol]);

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
      onClick={() => navigate(`/${bungalow.chain}/${bungalow.token_address}`)}
    >
      <span className={styles.glow} />
      <img
        className={styles.avatar}
        src={imageSrc}
        alt={bungalow.symbol ?? bungalow.name ?? "token"}
        loading="lazy"
        onError={() => {
          if (imageSrc !== fallbackImage) {
            setImageSrc(fallbackImage);
          }
        }}
      />
      <span className={styles.symbol}>{bungalow.symbol ?? "?"}</span>
      <NodeTooltip
        name={bungalow.name}
        symbol={bungalow.symbol}
        holderCount={bungalow.holder_count ?? 0}
        visible={isHovered}
      />
    </button>
  );
}
