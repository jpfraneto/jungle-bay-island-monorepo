import { useEffect, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";

interface TransactionWalletSelectorProps {
  onSelect: (address: string) => void;
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

export default function TransactionWalletSelector({
  onSelect,
  label = "Pay with",
  onAddWallet,
  isAddingWallet = false,
  addWalletStatus = null,
  addWalletError = null,
}: TransactionWalletSelectorProps) {
  const { authenticated, connectWallet, login } = usePrivy();
  const { walletAddress, setActiveWallet, wallets: connectedWallets } =
    usePrivyBaseWallet();
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
    () => new Set(connectedWallets.map((wallet) => wallet.address.toLowerCase())),
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
  const activeWalletLinked =
    Boolean(activeWalletAddress) &&
    linkedWallets.some(
      (linkedWallet) =>
        linkedWallet.toLowerCase() === activeWalletAddress.toLowerCase(),
    );
  const activeWalletAvailable =
    Boolean(activeWalletAddress) &&
    options.some(
      (address) => address.toLowerCase() === activeWalletAddress.toLowerCase(),
    );
  const selectorValue = activeWalletAvailable ? activeWalletAddress : options[0] ?? "";
  const hasUnavailableLinkedWallets = linkedWallets.length > options.length;

  useEffect(() => {
    if (!authenticated) return;
    if (!selectorValue) return;
    if (activeWalletAvailable) return;

    try {
      setActiveWallet(selectorValue);
      onSelect(selectorValue);
    } catch {
      // Keep the modal stable if Privy has not promoted the wallet yet.
    }
  }, [
    activeWalletAvailable,
    authenticated,
    onSelect,
    selectorValue,
    setActiveWallet,
  ]);

  if (!authenticated) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ fontSize: 13, color: "rgba(247,239,214,0.72)" }}>
          {label}
        </label>
        <button
          type="button"
          onClick={login}
          style={{
            minHeight: 42,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Connect
        </button>
      </div>
    );
  }

  if (!walletAddress) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ fontSize: 13, color: "rgba(247,239,214,0.72)" }}>
          {label}
        </label>
        <div
          style={{
            display: "grid",
            gap: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.18)",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, color: "rgba(247,239,214,0.84)" }}>
            Connect a wallet to continue.
          </div>
          <button
            type="button"
            onClick={() => connectWallet({ walletChainType: "ethereum-only" })}
            style={{
              minHeight: 40,
              borderRadius: 10,
              border: 0,
              background: "#2f6a2f",
              color: "white",
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
            }}
          >
            Connect wallet
          </button>
        </div>
        {loadError ? (
          <div style={{ color: "#ffd3d3", fontSize: 12 }}>{loadError}</div>
        ) : null}
        {addWalletStatus ? (
          <div style={{ color: "#9dd7a8", fontSize: 12 }}>{addWalletStatus}</div>
        ) : null}
        {addWalletError ? (
          <div style={{ color: "#ffd3d3", fontSize: 12 }}>{addWalletError}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label style={{ fontSize: 13, color: "rgba(247,239,214,0.72)" }}>
        {label}
      </label>
      {options.length > 1 ? (
        <select
          value={selectorValue}
          onChange={(event) => {
            const nextAddress = event.target.value;
            try {
              setActiveWallet(nextAddress);
              onSelect(nextAddress);
            } catch {
              // Ignore unavailable wallets until Privy exposes them.
            }
          }}
          disabled={isLoading}
          style={{
            minHeight: 48,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.38)",
            color: "#f7efd6",
            padding: "0 14px",
            font: "inherit",
          }}
        >
          {options.map((address) => (
            <option key={address} value={address}>
              {truncateAddress(address)}
            </option>
          ))}
        </select>
      ) : (
        <div
          style={{
            minHeight: 48,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.38)",
            color: "#f7efd6",
            padding: "10px 14px",
            display: "grid",
            gap: 2,
            alignContent: "center",
          }}
        >
          <strong>{truncateAddress(activeWalletAddress)}</strong>
          <span style={{ fontSize: 12, color: "rgba(247,239,214,0.66)" }}>
            {activeWalletLinked ? "Linked wallet" : "Current wallet"}
          </span>
        </div>
      )}

      {loadError ? (
        <div style={{ color: "#ffd3d3", fontSize: 12 }}>{loadError}</div>
      ) : null}
      {hasUnavailableLinkedWallets ? (
        <div style={{ color: "rgba(247,239,214,0.72)", fontSize: 12 }}>
          Only wallets currently connected in Privy can pay here.
        </div>
      ) : null}
      {!activeWalletLinked ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ color: "rgba(247,239,214,0.72)", fontSize: 12 }}>
            Link this wallet to use it for transactions.
          </div>
          {onAddWallet ? (
            <button
              type="button"
              onClick={onAddWallet}
              disabled={isAddingWallet}
              style={{
                minHeight: 38,
                padding: "0 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "white",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {isAddingWallet ? "Linking..." : "Link wallet"}
            </button>
          ) : null}
        </div>
      ) : null}
      {addWalletStatus ? (
        <div style={{ color: "#9dd7a8", fontSize: 12 }}>{addWalletStatus}</div>
      ) : null}
      {addWalletError ? (
        <div style={{ color: "#ffd3d3", fontSize: 12 }}>{addWalletError}</div>
      ) : null}
    </div>
  );
}
