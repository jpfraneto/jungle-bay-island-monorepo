import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import styles from "../styles/wallet-selector.module.css";

interface WalletSelectorProps {
  onSelect: (address: string) => void;
  label?: string;
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletSelector({
  onSelect,
  label = "Pay with",
}: WalletSelectorProps) {
  const { authenticated, login } = usePrivy();
  const { walletAddress, wallets, setActiveWallet } = usePrivyBaseWallet();
  const {
    wallets: linkedWalletRows,
    isLoading,
    error,
  } = useUserWalletLinks(authenticated);

  const [selectedWallet, setSelectedWallet] = useState<string>("");

  const linkedWallets = useMemo(
    () => linkedWalletRows.map((wallet) => wallet.address),
    [linkedWalletRows],
  );

  const connectedWalletAddresses = useMemo(
    () => wallets.map((wallet) => wallet.address),
    [wallets],
  );

  const options = useMemo(() => {
    const combined = [...linkedWallets, ...connectedWalletAddresses];
    return combined.filter(
      (address, index) =>
        combined.findIndex(
          (candidate) => candidate.toLowerCase() === address.toLowerCase(),
        ) === index,
    );
  }, [connectedWalletAddresses, linkedWallets]);

  const activeWalletAddress = walletAddress ?? "";

  const activeWalletNotLinked =
    Boolean(activeWalletAddress) &&
    !linkedWallets.some(
      (linkedWallet) => linkedWallet.toLowerCase() === activeWalletAddress.toLowerCase(),
    );

  useEffect(() => {
    if (!walletAddress) return;

    if (selectedWallet.toLowerCase() === walletAddress.toLowerCase()) {
      return;
    }

    setSelectedWallet(walletAddress);
    onSelect(walletAddress);
  }, [onSelect, selectedWallet, walletAddress]);

  if (!authenticated) {
    return (
      <div className={styles.selectorWrap}>
        <div className={styles.selectorHeader}>
          <span>{label}</span>
          <button
            type="button"
            className={styles.connectButton}
            onClick={login}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.selectorWrap}>
      <label className={styles.selectorLabel}>{label}</label>
      <select
        className={styles.selector}
        value={selectedWallet}
        onChange={(event) => {
          const nextAddress = event.target.value;
          setSelectedWallet(nextAddress);
          try {
            setActiveWallet(nextAddress);
          } catch {
            // Keep selector responsive even if Privy wallet sync lags.
          }
          onSelect(nextAddress);
        }}
        disabled={isLoading || options.length === 0}
      >
        {options.length === 0 ? (
          <option value="">No wallets connected</option>
        ) : (
          options.map((address) => {
            const isLinked = linkedWallets.some(
              (linkedWallet) => linkedWallet.toLowerCase() === address.toLowerCase(),
            );
            return (
              <option key={address} value={address}>
                {truncateAddress(address)}
                {isLinked ? "" : " · Current wallet (not linked)"}
              </option>
            );
          })
        )}
      </select>

      {error ? <p className={styles.error}>{error}</p> : null}
      {activeWalletNotLinked ? (
        <p className={styles.warning}>
          Link this wallet first to use it for transactions.
        </p>
      ) : null}
    </div>
  );
}
