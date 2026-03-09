import { useEffect, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import {
  getPrivyWalletChainType,
  getPrivyWalletList,
} from "../utils/privyWalletOptions";
import styles from "../styles/wallet-selector.module.css";

interface WalletSelectorProps {
  onSelect: (address: string) => void;
  value?: string | null;
  label?: string;
  onAddWallet?: () => void | Promise<void>;
  isAddingWallet?: boolean;
  addWalletStatus?: string | null;
  addWalletError?: string | null;
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletSelector({
  onSelect,
  value = null,
  label = "Sign with",
  onAddWallet,
  isAddingWallet = false,
  addWalletStatus = null,
  addWalletError = null,
}: WalletSelectorProps) {
  const { authenticated, connectWallet, login } = usePrivy();
  const {
    walletAddress,
    setActiveWallet,
    wallets: connectedWallets,
  } = usePrivyBaseWallet();
  const {
    wallets: linkedWalletRows,
    isLoading,
    error: loadError,
  } = useUserWalletLinks(authenticated);

  const linkedWallets = useMemo(
    () => linkedWalletRows.map((wallet) => wallet.address),
    [linkedWalletRows],
  );

  const connectedWalletAddresses = useMemo(
    () =>
      new Set(connectedWallets.map((wallet) => wallet.address.toLowerCase())),
    [connectedWallets],
  );
  const options = useMemo(
    () =>
      linkedWallets.filter((address) =>
        connectedWalletAddresses.has(address.toLowerCase()),
      ),
    [connectedWalletAddresses, linkedWallets],
  );

  const activeWalletAddress = walletAddress ?? "";
  const preferredWalletAddress = value?.trim() || "";
  const displayedWalletAddress =
    preferredWalletAddress || activeWalletAddress || options[0] || "";
  const selectorValue = options.some(
    (address) => address.toLowerCase() === displayedWalletAddress.toLowerCase(),
  )
    ? displayedWalletAddress
    : (options[0] ?? "");

  const activeWalletLinked =
    Boolean(activeWalletAddress) &&
    options.some(
      (linkedWallet) =>
        linkedWallet.toLowerCase() === activeWalletAddress.toLowerCase(),
    );
  const displayedWalletLinked =
    Boolean(displayedWalletAddress) &&
    options.some(
      (linkedWallet) =>
        linkedWallet.toLowerCase() === displayedWalletAddress.toLowerCase(),
    );
  const activeWalletNotLinked =
    Boolean(activeWalletAddress) &&
    !activeWalletLinked &&
    !displayedWalletLinked;
  const hasUnavailableLinkedWallets = linkedWallets.length > options.length;
  const showSelector = options.length > 1;

  useEffect(() => {
    if (!authenticated) return;
    if (!selectorValue) return;

    try {
      setActiveWallet(selectorValue);
      onSelect(selectorValue);
    } catch {
      // Keep the selector stable while Privy catches up.
    }
  }, [authenticated, onSelect, selectorValue, setActiveWallet]);

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

  if (!walletAddress) {
    return (
      <div className={styles.selectorWrap}>
        <label className={styles.selectorLabel}>{label}</label>
        <div className={styles.actionRow}>
          <p className={styles.warning}>Connect a wallet to continue.</p>
          <button
            type="button"
            className={styles.connectButton}
            onClick={() =>
              connectWallet({
                walletChainType: getPrivyWalletChainType(),
                walletList: getPrivyWalletList(),
              })
            }
          >
            Connect wallet
          </button>
        </div>
        {loadError ? <p className={styles.error}>{loadError}</p> : null}
        {addWalletStatus ? (
          <p className={styles.status}>{addWalletStatus}</p>
        ) : null}
        {addWalletError ? (
          <p className={styles.error}>{addWalletError}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.selectorWrap}>
      <label className={styles.selectorLabel}>{label}</label>
      {showSelector ? (
        <select
          className={styles.selector}
          value={selectorValue}
          onChange={(event) => {
            const nextAddress = event.target.value;
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
            <option value="">No linked wallets</option>
          ) : (
            options.map((address) => (
              <option key={address} value={address}>
                {truncateAddress(address)}
              </option>
            ))
          )}
        </select>
      ) : (
        <div className={styles.walletDisplay}>
          <strong>{truncateAddress(displayedWalletAddress)}</strong>
          <span>{displayedWalletLinked ? "Linked wallet" : "Current wallet"}</span>
        </div>
      )}

      {loadError ? <p className={styles.error}>{loadError}</p> : null}
      {hasUnavailableLinkedWallets ? (
        <p className={styles.warning}>
          Only wallets currently connected in Privy can sign here.
        </p>
      ) : null}
      {activeWalletNotLinked ? (
        <div className={styles.actionRow}>
          <p className={styles.warning}>
            Link this wallet to use it for transactions.
          </p>
          {onAddWallet ? (
            <button
              type="button"
              className={styles.connectButton}
              onClick={onAddWallet}
              disabled={isAddingWallet}
            >
              {isAddingWallet ? "Linking..." : "Link wallet"}
            </button>
          ) : null}
        </div>
      ) : null}
      {addWalletStatus ? (
        <p className={styles.status}>{addWalletStatus}</p>
      ) : null}
      {addWalletError ? <p className={styles.error}>{addWalletError}</p> : null}
    </div>
  );
}
