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
    <label className={styles.wrapper}>
      <select
        className={styles.select}
        value={selectedKey}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="Bungalow options"
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((bungalow) => {
          const optionKey = getBungalowKey(bungalow);
          const label = bungalow.symbol ?? bungalow.name ?? "Unknown bungalow";

          return (
            <option key={optionKey} value={optionKey}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
