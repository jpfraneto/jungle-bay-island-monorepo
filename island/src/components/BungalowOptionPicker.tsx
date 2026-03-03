import {
  getFallbackTokenImage,
  getTokenImageUrl,
} from "../utils/tokenImage";
import type { DirectoryBungalow } from "../utils/bodega";
import styles from "../styles/bungalow-option-picker.module.css";

interface BungalowOptionPickerProps {
  options: DirectoryBungalow[];
  selectedKey: string;
  onSelect: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

function getBungalowKey(bungalow: DirectoryBungalow): string {
  return `${bungalow.chain}:${bungalow.token_address}`;
}

export default function BungalowOptionPicker({
  options,
  selectedKey,
  onSelect,
  allowEmpty = false,
  emptyLabel = "No specific bungalow",
}: BungalowOptionPickerProps) {
  return (
    <div className={styles.list} role="listbox" aria-label="Bungalow options">
      {allowEmpty ? (
        <button
          type="button"
          className={`${styles.option} ${
            selectedKey === "" ? styles.optionActive : ""
          }`}
          onClick={() => onSelect("")}
        >
          <span className={styles.optionMeta}>
            <strong>{emptyLabel}</strong>
            <small>Leave this listing unattached to a source bungalow.</small>
          </span>
          {selectedKey === "" ? (
            <span className={styles.optionState}>Selected</span>
          ) : null}
        </button>
      ) : null}

      {options.map((bungalow) => {
        const optionKey = getBungalowKey(bungalow);
        const label = bungalow.symbol ?? bungalow.name ?? "Unknown bungalow";
        const subtitle =
          bungalow.symbol && bungalow.name && bungalow.name !== bungalow.symbol
            ? `${bungalow.name} · ${bungalow.chain}`
            : bungalow.chain;

        return (
          <button
            key={optionKey}
            type="button"
            className={`${styles.option} ${
              selectedKey === optionKey ? styles.optionActive : ""
            }`}
            onClick={() => onSelect(optionKey)}
          >
            <img
              className={styles.optionImage}
              src={getTokenImageUrl(
                bungalow.image_url,
                bungalow.token_address,
                bungalow.symbol,
              )}
              alt={label}
              loading="lazy"
              onError={(event) => {
                event.currentTarget.src = getFallbackTokenImage(
                  `${bungalow.chain}:${bungalow.token_address}`,
                );
              }}
            />
            <span className={styles.optionMeta}>
              <strong>{label}</strong>
              <small>{subtitle}</small>
            </span>
            {selectedKey === optionKey ? (
              <span className={styles.optionState}>Selected</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
