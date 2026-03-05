import type { BungalowItem } from "../hooks/useBungalowItems";
import WallItem from "./WallItem";
import styles from "../styles/wall.module.css";

interface WallProps {
  items: BungalowItem[];
  isLoading: boolean;
  onAdd: () => void;
}

export default function Wall({ items, isLoading, onAdd }: WallProps) {
  return (
    <section className={styles.wallSection}>
      <div className={styles.header}>
        <h2>Community Wall</h2>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          + Quick Add
        </button>
      </div>

      <div className={styles.scrollArea}>
        {isLoading ? <div className={styles.empty}>Loading wall items...</div> : null}

        {!isLoading && items.length === 0 ? (
          <div className={styles.empty}>
            This bungalow&apos;s wall is empty. Quick-add the first live item and it will also appear in the Bodega.
          </div>
        ) : null}

        <div className={styles.grid}>
          {items.map((item) => (
            <WallItem key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
