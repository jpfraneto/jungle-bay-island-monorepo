import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import styles from "../styles/bungalow-construction-modal.module.css";

interface BungalowConstructionModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BungalowConstructionModal({
  open,
  onClose,
}: BungalowConstructionModalProps) {
  const navigate = useNavigate();
  const [chain, setChain] = useState("base");
  const [tokenAddress, setTokenAddress] = useState("");

  useEffect(() => {
    if (!open) return;

    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const trimmedAddress = tokenAddress.trim();

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-bungalow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>Add a bungalow</p>
            <h3 id="claim-bungalow-title">Point the island at the asset you want to claim.</h3>
            <p className={styles.summary}>
              The bungalow itself is claimed on the asset page. Enter the chain
              and token address here, then the bungalow page will handle lookup,
              mint quote, and the actual onchain claim flow.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.formRow}>
          <label className={styles.field}>
            Chain
            <select value={chain} onChange={(event) => setChain(event.target.value)}>
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
              <option value="solana">Solana</option>
            </select>
          </label>

          <label className={`${styles.field} ${styles.addressField}`}>
            Token address
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              placeholder={chain === "solana" ? "Mint address" : "0x..."}
            />
          </label>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={!trimmedAddress}
            onClick={() => {
              navigate(`/bungalow/${encodeURIComponent(trimmedAddress)}?chain=${encodeURIComponent(chain)}`);
              onClose();
            }}
          >
            Open bungalow
          </button>
        </div>

        <div className={styles.panel}>
          <div className={styles.rules}>
            <p>1. Create your onchain profile from the Profile page.</p>
            <p>2. Open the asset’s bungalow page.</p>
            <p>3. Claim the bungalow there if it does not exist yet.</p>
            <p>4. Set its identity, add art, then start activating bonds through Bodega installs.</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
