import { formatNumber } from "../utils/formatters";
import styles from "../styles/node-tooltip.module.css";

interface NodeTooltipProps {
  name: string | null;
  symbol: string | null;
  holderCount: number;
  visible: boolean;
}

export default function NodeTooltip({ name, symbol, holderCount, visible }: NodeTooltipProps) {
  return (
    <div className={`${styles.tooltip} ${visible ? styles.visible : ""}`}>
      <div className={styles.title}>{name ?? symbol ?? "Unknown"}</div>
      <div className={styles.meta}>{formatNumber(holderCount)} holders</div>
    </div>
  );
}
