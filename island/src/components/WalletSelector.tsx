import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, type ConnectedWallet } from "@privy-io/react-auth";
import {
  getPrivyWalletChainType,
  getPrivyWalletList,
} from "../utils/privyWalletOptions";
import {
  useSiweWalletLink,
  type LinkedWalletResult,
} from "../hooks/useSiweWalletLink";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import styles from "../styles/wallet-selector.module.css";

export interface WalletSelectorState {
  selectedWallet: string | null;
  selectedWalletAvailable: boolean;
  hasAvailableWallet: boolean;
  availableWallets: string[];
  totalWallets: number;
  isLoading?: boolean;
}

interface WalletSelectorProps {
  onSelect: (address: string) => void;
  value?: string | null;
  label?: string;
  panelMode?: "floating" | "inline";
  eligibleWallets?: string[] | null;
  onStateChange?: (state: WalletSelectorState) => void;
  onWalletLinked?: (result: LinkedWalletResult) => void | Promise<void>;
}

interface WalletOption {
  address: string;
  sourceLabel: string | null;
  isConnected: boolean;
  isLinked: boolean;
  isActive: boolean;
  meetsEligibility: boolean;
  isAvailable: boolean;
  connectedAt: number;
  linkedAt: number;
}

function isHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatSourceLabel(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!normalized) return null;

  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function getWalletStatus(option: WalletOption): string {
  if (option.isAvailable) {
    return "Available here";
  }

  if (option.isConnected && !option.meetsEligibility) {
    return "Onchain link needed";
  }

  if (option.isConnected) {
    return "Connected, link needed";
  }

  if (option.isLinked) {
    return "Linked, not available here";
  }

  return "Unavailable";
}

function getWalletContextLabel(option: WalletOption): string {
  if (option.isAvailable) {
    return "Connected + linked";
  }

  if (option.isConnected && !option.meetsEligibility) {
    return "Connected in browser";
  }

  if (option.isConnected) {
    return "Connected in browser";
  }

  if (option.isLinked) {
    return "Linked on profile";
  }

  return "Unavailable";
}

function compareWalletOptions(
  left: WalletOption,
  right: WalletOption,
  preferredAddress: string,
): number {
  const leftKey = left.address.toLowerCase();
  const rightKey = right.address.toLowerCase();

  if (leftKey === preferredAddress && rightKey !== preferredAddress) return -1;
  if (rightKey === preferredAddress && leftKey !== preferredAddress) return 1;

  if (left.isAvailable !== right.isAvailable) {
    return left.isAvailable ? -1 : 1;
  }

  if (left.isConnected !== right.isConnected) {
    return left.isConnected ? -1 : 1;
  }

  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const leftRecency = Math.max(left.connectedAt, left.linkedAt);
  const rightRecency = Math.max(right.connectedAt, right.linkedAt);
  if (leftRecency !== rightRecency) {
    return rightRecency - leftRecency;
  }

  return left.address.localeCompare(right.address);
}

export default function WalletSelector({
  onSelect,
  value = null,
  label = "Sign with",
  panelMode = "floating",
  eligibleWallets = null,
  onStateChange,
  onWalletLinked,
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
    refetch: refetchLinkedWallets,
  } = useUserWalletLinks(authenticated);
  const {
    linkCurrentWallet,
    isLinking,
    status: linkStatus,
    error: linkError,
  } = useSiweWalletLink();

  const [open, setOpen] = useState(false);
  const [pendingPreferredWallet, setPendingPreferredWallet] = useState<
    string | null
  >(null);
  const [promoteNewestAvailableWallet, setPromoteNewestAvailableWallet] =
    useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const preferredAddress = value?.trim().toLowerCase() ?? "";
  const eligibleWalletSet = useMemo(
    () =>
      eligibleWallets === null
        ? null
        : new Set(eligibleWallets.map((wallet) => wallet.toLowerCase())),
    [eligibleWallets],
  );
  const showLoadingState = isLoading && linkedWalletRows.length === 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const options = useMemo(() => {
    const optionMap = new Map<string, WalletOption>();

    const upsert = (address: string, patch: Partial<WalletOption>) => {
      if (!isHexAddress(address)) {
        return;
      }

      const key = address.toLowerCase();
      const current =
        optionMap.get(key) ??
        ({
          address,
          sourceLabel: null,
          isConnected: false,
          isLinked: false,
          isActive: false,
          meetsEligibility: eligibleWalletSet !== null,
          isAvailable: false,
          connectedAt: 0,
          linkedAt: 0,
        } satisfies WalletOption);

      const next: WalletOption = {
        ...current,
        ...patch,
        address: current.address,
      };

      next.meetsEligibility = eligibleWalletSet !== null
        ? eligibleWalletSet.has(key)
        : next.isLinked;
      next.isAvailable = next.isConnected && next.meetsEligibility;
      optionMap.set(key, next);
    };

    linkedWalletRows.forEach((wallet) => {
      upsert(wallet.address, {
        address: wallet.address,
        sourceLabel: formatSourceLabel(wallet.source),
        isLinked: true,
        linkedAt: Date.parse(wallet.linked_at) || 0,
      });
    });

    connectedWallets.forEach((wallet: ConnectedWallet) => {
      upsert(wallet.address, {
        address: wallet.address,
        sourceLabel:
          formatSourceLabel(wallet.connectorType) ??
          formatSourceLabel(wallet.walletClientType),
        isConnected: true,
        isActive: walletAddress?.toLowerCase() === wallet.address.toLowerCase(),
        connectedAt: wallet.connectedAt,
      });
    });

    return [...optionMap.values()].sort((left, right) =>
      compareWalletOptions(left, right, preferredAddress),
    );
  }, [
    connectedWallets,
    eligibleWalletSet,
    linkedWalletRows,
    preferredAddress,
    walletAddress,
  ]);

  const selectedOption = useMemo(() => {
    if (!preferredAddress) {
      return null;
    }

    return (
      options.find(
        (option) => option.address.toLowerCase() === preferredAddress,
      ) ?? null
    );
  }, [options, preferredAddress]);

  const firstAvailableOption = useMemo(
    () => options.find((option) => option.isAvailable) ?? null,
    [options],
  );
  const selectedOrFallbackOption =
    selectedOption ?? firstAvailableOption ?? options[0] ?? null;
  const availableWalletCount = options.filter(
    (option) => option.isAvailable,
  ).length;
  const newestAvailableOption = useMemo(() => {
    const availableOptions = options.filter((option) => option.isAvailable);
    if (availableOptions.length === 0) {
      return null;
    }

    return [...availableOptions].sort(
      (left, right) =>
        Math.max(right.connectedAt, right.linkedAt) -
        Math.max(left.connectedAt, left.linkedAt),
    )[0];
  }, [options]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    if (selectedOption) {
      return;
    }

    const fallbackOption =
      firstAvailableOption ??
      options.find((option) => option.isConnected) ??
      options[0] ??
      null;

    if (!fallbackOption) {
      return;
    }

    if (fallbackOption.isAvailable) {
      try {
        setActiveWallet(fallbackOption.address);
      } catch {
        // Privy wallet state can lag briefly after a reconnect.
      }
    }

    onSelect(fallbackOption.address);
  }, [
    authenticated,
    firstAvailableOption,
    onSelect,
    options,
    selectedOption,
    setActiveWallet,
  ]);

  useEffect(() => {
    if (!pendingPreferredWallet) {
      return;
    }

    const nextOption = options.find(
      (option) =>
        option.address.toLowerCase() === pendingPreferredWallet.toLowerCase() &&
        option.isAvailable,
    );
    if (!nextOption) {
      return;
    }

    try {
      setActiveWallet(nextOption.address);
    } catch {
      // Privy wallet state can lag briefly after a reconnect.
    }

    onSelect(nextOption.address);
    setPendingPreferredWallet(null);
    setPromoteNewestAvailableWallet(false);
    setOpen(false);
  }, [onSelect, options, pendingPreferredWallet, setActiveWallet]);

  useEffect(() => {
    if (!promoteNewestAvailableWallet || !newestAvailableOption) {
      return;
    }

    try {
      setActiveWallet(newestAvailableOption.address);
    } catch {
      // Privy wallet state can lag briefly after a reconnect.
    }

    onSelect(newestAvailableOption.address);
    setPromoteNewestAvailableWallet(false);
    setOpen(false);
  }, [
    newestAvailableOption,
    onSelect,
    promoteNewestAvailableWallet,
    setActiveWallet,
  ]);

  useEffect(() => {
    onStateChange?.({
      selectedWallet: selectedOption?.address ?? null,
      selectedWalletAvailable: Boolean(selectedOption?.isAvailable),
      hasAvailableWallet: options.some((option) => option.isAvailable),
      availableWallets: options
        .filter((option) => option.isAvailable)
        .map((option) => option.address),
      totalWallets: options.length,
      isLoading: showLoadingState,
    });
  }, [onStateChange, options, selectedOption, showLoadingState]);

  const handleChooseWallet = (option: WalletOption) => {
    if (!option.isAvailable) {
      return;
    }

    try {
      setActiveWallet(option.address);
    } catch {
      // Privy wallet state can lag briefly after a reconnect.
    }

    onSelect(option.address);
    setOpen(false);
  };

  const handleLinkWallet = async () => {
    try {
      const result = await linkCurrentWallet();
      await refetchLinkedWallets();

      if (result.didLinkWallet) {
        if (result.linkedAddress) {
          setPendingPreferredWallet(result.linkedAddress);
        } else {
          setPromoteNewestAvailableWallet(true);
        }
      }

      await onWalletLinked?.(result);
    } catch {
      // The hook already surfaces a user-facing error message.
    }
  };

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

  if (showLoadingState) {
    return (
      <div ref={rootRef} className={styles.selectorWrap}>
        <label className={styles.selectorLabel}>{label}</label>
        <div className={styles.loadingCard} aria-live="polite">
          <div className={`${styles.loadingLine} ${styles.loadingLinePrimary}`} />
          <div className={`${styles.loadingLine} ${styles.loadingLineSecondary}`} />
        </div>
        <p className={styles.hint}>Loading wallet availability...</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.selectorWrap}>
      <label className={styles.selectorLabel}>{label}</label>

      {options.length > 0 ? (
        <div className={styles.chooser}>
          <button
            type="button"
            className={styles.trigger}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
          >
            <div className={styles.triggerCopy}>
              <div className={styles.triggerTopline}>
                <strong>
                  {truncateAddress(selectedOrFallbackOption?.address ?? "")}
                </strong>
                {selectedOrFallbackOption?.isActive ? (
                  <span className={`${styles.badge} ${styles.badgeMuted}`}>
                    Current
                  </span>
                ) : null}
              </div>
              <div className={styles.triggerMeta}>
                <span className={styles.triggerSource}>
                  {selectedOrFallbackOption?.sourceLabel ?? "External wallet"}
                </span>
                {selectedOrFallbackOption ? (
                  <span
                    className={`${styles.badge} ${
                      selectedOrFallbackOption.isAvailable
                        ? styles.badgeAvailable
                        : selectedOrFallbackOption.isConnected
                          ? styles.badgeAttention
                          : styles.badgeReconnect
                    }`}
                  >
                    {getWalletStatus(selectedOrFallbackOption)}
                  </span>
                ) : null}
              </div>
            </div>
            <span className={styles.chevron}>{open ? "−" : "+"}</span>
          </button>

          {open ? (
            <div
              className={`${styles.panel} ${
                panelMode === "inline" ? styles.panelInline : ""
              }`}
            >
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderCopy}>
                  <strong>Choose wallet</strong>
                  <span>
                    {availableWalletCount} available of {options.length} linked
                    or connected
                  </span>
                </div>
              </div>
              <div className={styles.optionList}>
                {options.map((option) => {
                  const isSelected =
                    selectedOption?.address.toLowerCase() ===
                    option.address.toLowerCase();

                  return (
                    <button
                      key={option.address.toLowerCase()}
                      type="button"
                      className={`${styles.option} ${
                        isSelected ? styles.optionSelected : ""
                      } ${!option.isAvailable ? styles.optionUnavailable : ""}`}
                      onClick={() => handleChooseWallet(option)}
                      aria-disabled={!option.isAvailable}
                      aria-pressed={isSelected}
                    >
                      <div className={styles.optionCopy}>
                        <div className={styles.optionTopline}>
                          <strong>{truncateAddress(option.address)}</strong>
                          {option.isActive ? (
                            <span
                              className={`${styles.badge} ${styles.badgeMuted}`}
                            >
                              Current
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.optionDetails}>
                          <span>{option.sourceLabel ?? "External wallet"}</span>
                          <span className={styles.optionDivider} />
                          <span>{getWalletContextLabel(option)}</span>
                        </div>
                      </div>
                      <div className={styles.optionMeta}>
                        <span
                          className={`${styles.badge} ${
                            option.isAvailable
                              ? styles.badgeAvailable
                              : option.isConnected
                                ? styles.badgeAttention
                                : styles.badgeReconnect
                          }`}
                        >
                          {getWalletStatus(option)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className={styles.panelFooter}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    void handleLinkWallet();
                  }}
                  disabled={isLinking}
                >
                  {isLinking ? "Linking..." : "Link new wallet"}
                </button>
                {loadError ? <p className={styles.error}>{loadError}</p> : null}
                {linkStatus ? (
                  <p className={styles.status}>{linkStatus}</p>
                ) : null}
                {linkError ? <p className={styles.error}>{linkError}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.emptyState}>
          {isLoading ? (
            <p className={styles.warning}>Loading wallets...</p>
          ) : (
            <p className={styles.warning}>
              No connected wallets yet. Link one to pay or sign here.
            </p>
          )}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              void handleLinkWallet();
            }}
            disabled={isLinking}
          >
            {isLinking ? "Linking..." : "Link new wallet"}
          </button>
          {loadError ? <p className={styles.error}>{loadError}</p> : null}
          {linkStatus ? <p className={styles.status}>{linkStatus}</p> : null}
          {linkError ? <p className={styles.error}>{linkError}</p> : null}
        </div>
      )}

      {options.length === 0 ? null : (
        <p className={styles.hint}>
          Available wallets can sign here now. Others stay visible so you can
          see what needs linking or reconnecting.
        </p>
      )}

      {!walletAddress ? (
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
          Connect another wallet
        </button>
      ) : null}
    </div>
  );
}
