import { useCallback, useEffect, useState } from "react";
import { useModalStatus, usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import WalletSelector, { type WalletSelectorState } from "../components/WalletSelector";
import { useMemeticsProfile } from "../hooks/useMemeticsProfile";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { formatNumber } from "../utils/formatters";
import {
  getMemeticsErrorMessage,
  MEMETICS_CONTRACT_ADDRESS,
  memeticsAbi,
} from "../utils/memetics";
import {
  getPrivyWalletChainType,
  getPrivyWalletList,
  isMobileBrowser,
} from "../utils/privyWalletOptions";
import styles from "../styles/profile-page.module.css";

interface UserProfileResponse {
  island_heat?: number;
  tier?: string;
  token_breakdown?: unknown[];
  scans?: unknown[];
  x_username?: string | null;
}

interface RegisterProfileSignatureResponse {
  contract_address?: string;
  wallet?: string;
  handle?: string;
  heat_score?: number;
  salt?: `0x${string}`;
  deadline?: number;
  sig?: `0x${string}`;
  error?: string;
}

interface LinkWalletSignatureResponse {
  contract_address?: string;
  profile_id?: number;
  wallet?: string;
  heat_score?: number;
  salt?: `0x${string}`;
  deadline?: number;
  sig?: `0x${string}`;
  error?: string;
}

interface SyncHeatSignatureResponse {
  contract_address?: string;
  profile_id?: number;
  wallet?: string;
  heat_score?: number;
  salt?: `0x${string}`;
  deadline?: number;
  sig?: `0x${string}`;
  error?: string;
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, "").toLowerCase();
  return clean ? `@${clean}` : "";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const {
    authenticated,
    getAccessToken,
    linkWallet,
    linkTwitter,
    login,
    logout,
    unlinkTwitter,
    user,
  } = usePrivy();
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const { publicClient, requireWallet, walletAddress } = usePrivyBaseWallet();
  const {
    data: memeticsProfile,
    isLoading: isMemeticsProfileLoading,
    error: memeticsProfileError,
    refetch: refetchMemeticsProfile,
  } = useMemeticsProfile(authenticated);
  const {
    wallets: linkedWallets,
    isLoading: isWalletsLoading,
    error: walletsError,
    refetch: refetchWallets,
  } = useUserWalletLinks(authenticated);

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unlinkingWallet, setUnlinkingWallet] = useState<string | null>(null);
  const [walletActionError, setWalletActionError] = useState<string | null>(
    null,
  );
  const [walletLinkStatus, setWalletLinkStatus] = useState<string | null>(null);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [pendingWalletLink, setPendingWalletLink] = useState(false);
  const [walletLinkModalOpened, setWalletLinkModalOpened] = useState(false);
  const [walletCountBeforeLink, setWalletCountBeforeLink] = useState(0);
  const [isLinkingX, setIsLinkingX] = useState(false);
  const [xError, setXError] = useState<string | null>(null);
  const [claimedXUsername, setClaimedXUsername] = useState<string | null>(null);
  const [pendingTwitterSync, setPendingTwitterSync] = useState(false);
  const [selectedContractWallet, setSelectedContractWallet] = useState("");
  const [contractWalletState, setContractWalletState] =
    useState<WalletSelectorState>({
      selectedWallet: null,
      selectedWalletAvailable: false,
      hasAvailableWallet: false,
      availableWallets: [],
      totalWallets: 0,
    });
  const [isOnchainActionPending, setIsOnchainActionPending] = useState(false);
  const [onchainStatus, setOnchainStatus] = useState<string | null>(null);
  const [onchainError, setOnchainError] = useState<string | null>(null);

  useEffect(() => {
    setClaimedXUsername((current) => {
      if (current) return current;

      const fromProfile =
        typeof profile?.x_username === "string" ? profile.x_username : null;
      if (fromProfile && fromProfile.trim().length > 0) {
        return normalizeXUsername(fromProfile);
      }

      const fromUser =
        typeof user?.twitter?.username === "string"
          ? user.twitter.username
          : "";
      const normalized = normalizeXUsername(fromUser);
      return normalized || null;
    });
  }, [profile?.x_username, user?.twitter?.username]);

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedContractWallet) return;
    setSelectedContractWallet(walletAddress);
  }, [selectedContractWallet, walletAddress]);

  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/wallet/${encodeURIComponent(walletAddress)}?aggregate=true`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          setProfile(null);
          return;
        }

        const data = (await response.json()) as UserProfileResponse;
        setProfile(data);
      } catch {
        setProfile(null);
      } finally {
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [authenticated, walletAddress]);

  const syncXHandle = useCallback(
    async (username: string) => {
      const normalized = normalizeXUsername(username);
      if (!normalized) return;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/user/link-x", {
        method: "POST",
        headers,
        body: JSON.stringify({ x_username: normalized }),
      });

      if (response.status === 409) {
        setXError(
          "This X account is already linked to another Jungle Bay Island profile. Contact support if you believe this is an error.",
        );
        return;
      }

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      setClaimedXUsername(normalized);
      setXError(null);
    },
    [getAccessToken],
  );

  useEffect(() => {
    if (!pendingTwitterSync) return;

    const username = user?.twitter?.username;
    if (!username) return;

    void (async () => {
      try {
        await syncXHandle(username);
      } catch (err) {
        setXError(
          err instanceof Error ? err.message : "Failed to link X account",
        );
      } finally {
        setPendingTwitterSync(false);
        setIsLinkingX(false);
      }
    })();
  }, [pendingTwitterSync, syncXHandle, user?.twitter?.username]);

  useEffect(() => {
    if (!pendingTwitterSync) return;

    const timeout = window.setTimeout(() => {
      setPendingTwitterSync(false);
      setIsLinkingX(false);
    }, 30_000);

    return () => window.clearTimeout(timeout);
  }, [pendingTwitterSync]);

  const syncLinkedWalletsFromPrivy = useCallback(async () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch("/api/user/sync-wallets", {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const data = (await response.json().catch(() => null)) as {
      wallets?: unknown;
    } | null;
    const walletCount = Array.isArray(data?.wallets)
      ? data.wallets.length
      : null;

    await refetchWallets();
    return walletCount;
  }, [getAccessToken, refetchWallets]);

  const waitForLinkedWalletSync = useCallback(
    async (previousCount: number) => {
      let latestCount: number | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          latestCount = await syncLinkedWalletsFromPrivy();
          if (typeof latestCount === "number" && latestCount > previousCount) {
            return { didLinkWallet: true, walletCount: latestCount };
          }
        } catch (error) {
          lastError = error;
        }

        if (attempt < 5) {
          await wait(1_000);
        }
      }

      if (lastError) {
        throw lastError;
      }

      return { didLinkWallet: false, walletCount: latestCount };
    },
    [syncLinkedWalletsFromPrivy],
  );

  useEffect(() => {
    if (!pendingWalletLink) return;

    if (isPrivyModalOpen) {
      if (!walletLinkModalOpened) {
        setWalletLinkModalOpened(true);
      }
      return;
    }

    if (!walletLinkModalOpened) return;

    let cancelled = false;

    void (async () => {
      let nextStatus: string | null = null;
      let nextError: string | null = null;

      try {
        const { didLinkWallet } = await waitForLinkedWalletSync(
          walletCountBeforeLink,
        );
        if (cancelled) return;

        nextStatus =
          didLinkWallet
            ? "Wallet linked successfully."
            : "No new wallet was linked.";
        nextError = null;
      } catch (error) {
        if (cancelled) return;
        nextError =
          error instanceof Error
            ? error.message
            : "Failed to sync linked wallets";
        nextStatus = null;
      }

      if (cancelled) return;
      setWalletLinkStatus(nextStatus);
      setWalletActionError(nextError);
      setIsLinkingWallet(false);
      setPendingWalletLink(false);
      setWalletLinkModalOpened(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isPrivyModalOpen,
    pendingWalletLink,
    waitForLinkedWalletSync,
    walletCountBeforeLink,
    walletLinkModalOpened,
  ]);

  useEffect(() => {
    if (!pendingWalletLink || walletLinkModalOpened) return;

    const timeout = window.setTimeout(() => {
      setPendingWalletLink(false);
      setIsLinkingWallet(false);
      setWalletLinkStatus(null);
      setWalletActionError(
        "Wallet link modal did not open. Allow wallet popups and try again.",
      );
    }, 8_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingWalletLink, walletLinkModalOpened]);

  const handleAddWallet = async () => {
    setWalletActionError(null);
    setWalletLinkStatus("Choose a wallet in Privy to link it.");
    setWalletCountBeforeLink(linkedWallets.length);
    setPendingWalletLink(true);
    setWalletLinkModalOpened(false);
    setIsLinkingWallet(true);

    const walletChainType = getPrivyWalletChainType();
    const walletList = getPrivyWalletList();

    linkWallet({
      walletChainType,
      walletList,
    });
  };

  const handleUnlinkWallet = async (address: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to unlink this wallet? You won't be able to use it for transactions until you re-link it.",
    );
    if (!confirmed) return;

    setUnlinkingWallet(address);
    setWalletActionError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `/api/user/link-wallet/${encodeURIComponent(address)}`,
        {
          method: "DELETE",
          headers,
        },
      );

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      await refetchWallets();
    } catch (err) {
      setWalletActionError(
        err instanceof Error ? err.message : "Failed to unlink wallet",
      );
    } finally {
      setUnlinkingWallet(null);
    }
  };

  const handleLinkX = async () => {
    setXError(null);
    setIsLinkingX(true);
    setPendingTwitterSync(true);
    linkTwitter();
  };

  const handleUnlinkX = async () => {
    const confirmed = window.confirm(
      "Unlinking your X account will remove your handle from your profile.",
    );
    if (!confirmed) return;

    if (!user?.twitter?.subject) {
      setXError("Missing linked X subject.");
      return;
    }

    try {
      await unlinkTwitter(user.twitter.subject);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      await fetch("/api/user/unlink-x", {
        method: "POST",
        headers,
      });

      setClaimedXUsername(null);
      setXError(null);
    } catch (err) {
      setXError(
        err instanceof Error ? err.message : "Failed to unlink X account",
      );
    }
  };

  const runOnchainAction = useCallback(
    async (action: () => Promise<void>) => {
      setOnchainError(null);
      setOnchainStatus(null);
      setIsOnchainActionPending(true);

      try {
        await action();
        await refetchMemeticsProfile().catch(() => undefined);
      } catch (actionError) {
        setOnchainError(
          getMemeticsErrorMessage(actionError, "Memetics action failed"),
        );
      } finally {
        setIsOnchainActionPending(false);
      }
    },
    [refetchMemeticsProfile],
  );

  const handleRegisterOnchainProfile = useCallback(async () => {
    await runOnchainAction(async () => {
      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      if (!memeticsProfile?.preferred_handle) {
        throw new Error("Link your X handle before creating an onchain profile.");
      }

      if (!contractWalletState.selectedWalletAvailable) {
        throw new Error("Choose a connected wallet that is linked to your Privy account.");
      }

      const { address, walletClient } = await requireWallet();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      setOnchainStatus("Requesting profile signature...");
      const response = await fetch("/api/memetics/register/sign", {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: address,
        }),
      });
      const data =
        (await response.json().catch(() => null)) as RegisterProfileSignatureResponse | null;

      if (
        !response.ok ||
        !data?.handle ||
        data.heat_score === undefined ||
        !data.salt ||
        data.deadline === undefined ||
        !data.sig
      ) {
        throw new Error(
          data?.error ?? `Profile signing failed (${response.status})`,
        );
      }

      const contractAddress =
        (typeof data.contract_address === "string"
          ? data.contract_address
          : MEMETICS_CONTRACT_ADDRESS) as `0x${string}`;
      const args = [
        data.handle,
        BigInt(data.heat_score),
        data.salt,
        BigInt(data.deadline),
        data.sig,
      ] as const;

      setOnchainStatus("Checking onchain profile registration...");
      await publicClient.simulateContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "registerProfile",
        args,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "registerProfile",
        args,
        account: address,
      });

      setOnchainStatus("Waiting for Base confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Onchain profile registration failed");
      }

      setOnchainStatus("Onchain profile created.");
    });
  }, [
    contractWalletState.selectedWalletAvailable,
    getAccessToken,
    memeticsProfile?.preferred_handle,
    publicClient,
    requireWallet,
    runOnchainAction,
  ]);

  const handleLinkWalletOnchain = useCallback(async () => {
    await runOnchainAction(async () => {
      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      if (!memeticsProfile?.profile) {
        throw new Error("Create your onchain profile first.");
      }

      if (!contractWalletState.selectedWalletAvailable) {
        throw new Error("Choose a connected wallet that is linked to your Privy account.");
      }

      const { address, walletClient } = await requireWallet();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      setOnchainStatus("Requesting wallet-link signature...");
      const response = await fetch("/api/memetics/link-wallet/sign", {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: address,
        }),
      });
      const data =
        (await response.json().catch(() => null)) as LinkWalletSignatureResponse | null;

      if (
        !response.ok ||
        data?.profile_id === undefined ||
        data.heat_score === undefined ||
        !data.salt ||
        data.deadline === undefined ||
        !data.sig
      ) {
        throw new Error(
          data?.error ?? `Wallet-link signing failed (${response.status})`,
        );
      }

      const contractAddress =
        (typeof data.contract_address === "string"
          ? data.contract_address
          : MEMETICS_CONTRACT_ADDRESS) as `0x${string}`;
      const args = [
        BigInt(data.profile_id),
        BigInt(data.heat_score),
        data.salt,
        BigInt(data.deadline),
        data.sig,
      ] as const;

      setOnchainStatus("Checking onchain wallet link...");
      await publicClient.simulateContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "linkWallet",
        args,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "linkWallet",
        args,
        account: address,
      });

      setOnchainStatus("Waiting for Base confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Onchain wallet link failed");
      }

      setOnchainStatus("Wallet linked onchain.");
    });
  }, [
    contractWalletState.selectedWalletAvailable,
    getAccessToken,
    memeticsProfile?.profile,
    publicClient,
    requireWallet,
    runOnchainAction,
  ]);

  const handleSyncOnchainHeat = useCallback(async () => {
    await runOnchainAction(async () => {
      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      if (!memeticsProfile?.profile) {
        throw new Error("Create your onchain profile first.");
      }

      const onchainWallets = memeticsProfile.profile.wallets.map((wallet) =>
        wallet.toLowerCase(),
      );
      if (
        !selectedContractWallet ||
        !onchainWallets.includes(selectedContractWallet.toLowerCase())
      ) {
        throw new Error("Choose a connected wallet that is already linked onchain.");
      }

      const { address, walletClient } = await requireWallet();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      setOnchainStatus("Requesting heat sync...");
      const response = await fetch("/api/memetics/sync-heat/sign", {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: address,
        }),
      });
      const data =
        (await response.json().catch(() => null)) as SyncHeatSignatureResponse | null;

      if (
        !response.ok ||
        data?.profile_id === undefined ||
        data.heat_score === undefined ||
        !data.salt ||
        data.deadline === undefined ||
        !data.sig
      ) {
        throw new Error(data?.error ?? `Heat sync failed (${response.status})`);
      }

      const contractAddress =
        (typeof data.contract_address === "string"
          ? data.contract_address
          : MEMETICS_CONTRACT_ADDRESS) as `0x${string}`;
      const args = [
        BigInt(data.profile_id),
        BigInt(data.heat_score),
        data.salt,
        BigInt(data.deadline),
        data.sig,
      ] as const;

      setOnchainStatus("Checking heat sync...");
      await publicClient.simulateContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "syncHeat",
        args,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: memeticsAbi,
        functionName: "syncHeat",
        args,
        account: address,
      });

      setOnchainStatus("Waiting for Base confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Heat sync transaction failed");
      }

      setOnchainStatus("Onchain heat synced.");
    });
  }, [
    getAccessToken,
    memeticsProfile?.profile,
    publicClient,
    requireWallet,
    runOnchainAction,
    selectedContractWallet,
  ]);

  const handleSetMainWalletOnchain = useCallback(
    async (nextMainWallet: string) => {
      await runOnchainAction(async () => {
        if (!publicClient) {
          throw new Error("Missing Base public client");
        }

        if (!memeticsProfile?.profile) {
          throw new Error("Create your onchain profile first.");
        }

        const onchainWallets = memeticsProfile.profile.wallets.map((wallet) =>
          wallet.toLowerCase(),
        );
        if (
          !selectedContractWallet ||
          !onchainWallets.includes(selectedContractWallet.toLowerCase())
        ) {
          throw new Error(
            "Choose a connected wallet that is already linked onchain.",
          );
        }

        const { address, walletClient } = await requireWallet();
        setOnchainStatus("Checking main wallet update...");
        await publicClient.simulateContract({
          address: MEMETICS_CONTRACT_ADDRESS,
          abi: memeticsAbi,
          functionName: "setMainWallet",
          args: [nextMainWallet as `0x${string}`],
          account: address,
        });

        const hash = await walletClient.writeContract({
          address: MEMETICS_CONTRACT_ADDRESS,
          abi: memeticsAbi,
          functionName: "setMainWallet",
          args: [nextMainWallet as `0x${string}`],
          account: address,
        });

        setOnchainStatus("Waiting for Base confirmation...");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Main wallet update failed");
        }

        setOnchainStatus("Main wallet updated.");
      });
    },
    [
      memeticsProfile?.profile,
      publicClient,
      requireWallet,
      runOnchainAction,
      selectedContractWallet,
    ],
  );

  if (!authenticated) {
    return (
      <section className={styles.page}>
        <article className={styles.card}>
          <h1>Profile</h1>
          <p>Connect your account to view your profile.</p>
          <button type="button" className={styles.actionButton} onClick={login}>
            Connect
          </button>
        </article>
      </section>
    );
  }

  const islandHeat = Number(profile?.island_heat ?? 0);
  const tier = profile?.tier ?? "drifter";
  const isProfileStatsLoading = isLoading;
  const isEmailLoginUser = Boolean(user?.email);
  const isXLoginUser = Boolean(user?.twitter) && !user?.email;
  const emailClaimedHandle = claimedXUsername || null;
  const preferredOnchainHandle = memeticsProfile?.preferred_handle ?? null;
  const onchainProfile = memeticsProfile?.profile ?? null;
  const onchainWallets = onchainProfile?.wallets ?? [];
  const selectedWalletLower = selectedContractWallet.toLowerCase();
  const selectedWalletOnchainLinked = onchainWallets.some(
    (wallet) => wallet.toLowerCase() === selectedWalletLower,
  );
  const canRegisterOnchainProfile =
    !onchainProfile &&
    Boolean(preferredOnchainHandle) &&
    contractWalletState.selectedWalletAvailable;
  const canLinkSelectedWalletOnchain =
    Boolean(onchainProfile) &&
    contractWalletState.selectedWalletAvailable &&
    !selectedWalletOnchainLinked;

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Profile</h1>

        {isEmailLoginUser ? (
          <section className={styles.linkedWallets}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Handle</h2>
              </div>
            </div>

            {!emailClaimedHandle ? (
              <div className={styles.walletRow}>
                <div>
                  <strong>Claim your handle</strong>
                  <span>
                    Link your X account to get a username on Jungle Bay Island.
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => {
                    void handleLinkX();
                  }}
                  disabled={isLinkingX}
                >
                  {isLinkingX ? "Linking..." : "Link X account"}
                </button>
              </div>
            ) : (
              <div className={styles.walletRow}>
                <div>
                  <strong>{emailClaimedHandle}</strong>
                </div>
                <button
                  type="button"
                  className={styles.unlinkButton}
                  onClick={() => {
                    void handleUnlinkX();
                  }}
                >
                  Unlink
                </button>
              </div>
            )}

            {xError ? <p className={styles.inlineError}>{xError}</p> : null}
          </section>
        ) : null}

        {isXLoginUser ? (
          <section className={styles.linkedWallets}>
            <div className={styles.walletRow}>
              <div>
                <strong>
                  @{user?.twitter?.username ?? "unknown"} ✓ Verified via X
                </strong>
              </div>
            </div>
          </section>
        ) : null}

        <div className={styles.stats}>
          <div>
            <span>Island Heat</span>
            <strong className={isProfileStatsLoading ? styles.metricLoading : ""}>
              {isProfileStatsLoading ? "88.8°" : `${islandHeat.toFixed(1)}°`}
            </strong>
          </div>
          <div>
            <span>Tier</span>
            <strong className={isProfileStatsLoading ? styles.metricLoading : ""}>
              {isProfileStatsLoading ? "Drifter" : tier}
            </strong>
          </div>
          <div>
            <span>Linked Wallets</span>
            <strong className={isWalletsLoading ? styles.metricLoading : ""}>
              {isWalletsLoading ? "88" : formatNumber(linkedWallets.length)}
            </strong>
          </div>
        </div>

        <section className={styles.linkedWallets}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Onchain Profile</h2>
              <p>
                Memetics contract actions now run through an onchain profile
                keyed to your X handle. Use a connected wallet from your Privy
                account to create the profile, link more wallets, sync heat,
                and choose the main payout wallet.
              </p>
            </div>
          </div>

          <WalletSelector
            label="Transaction wallet"
            panelMode="inline"
            value={selectedContractWallet}
            onSelect={(nextWallet) => {
              setSelectedContractWallet(nextWallet);
              setOnchainError(null);
            }}
            onStateChange={setContractWalletState}
          />

          {memeticsProfileError ? (
            <p className={styles.inlineError}>{memeticsProfileError}</p>
          ) : null}
          {onchainError ? (
            <p className={styles.inlineError}>{onchainError}</p>
          ) : null}
          {onchainStatus ? (
            <p className={styles.inlineStatus}>{onchainStatus}</p>
          ) : null}

          {!preferredOnchainHandle ? (
            <div className={styles.walletRow}>
              <div>
                <strong>Link X before you go onchain</strong>
                <span>
                  The Memetics contract uses your X handle as the readable entry
                  point for identity, so the contract profile cannot be created
                  until your handle is linked above.
                </span>
              </div>
            </div>
          ) : null}

          {isMemeticsProfileLoading ? (
            <p className={styles.placeholder}>Loading onchain profile...</p>
          ) : null}

          {!isMemeticsProfileLoading && !onchainProfile ? (
            <div className={styles.walletList}>
              <div className={styles.walletRow}>
                <div>
                  <strong>@{preferredOnchainHandle}</strong>
                  <span>
                    No Memetics profile exists yet. Create it with a connected
                    wallet from your Privy account, then the rest of the app can
                    use contract-native claims, bungalow petitions, and Bodega
                    installs.
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => {
                    void handleRegisterOnchainProfile();
                  }}
                  disabled={isOnchainActionPending || !canRegisterOnchainProfile}
                >
                  {isOnchainActionPending ? "Working..." : "Create onchain profile"}
                </button>
              </div>
              {!preferredOnchainHandle ? null : !contractWalletState.selectedWalletAvailable ? (
                <p className={styles.inlineError}>
                  Choose a connected wallet that is already linked to your Privy
                  account before registering onchain.
                </p>
              ) : null}
            </div>
          ) : null}

          {onchainProfile ? (
            <>
              <div className={styles.stats}>
                <div>
                  <span>Profile ID</span>
                  <strong>{formatNumber(onchainProfile.id)}</strong>
                </div>
                <div>
                  <span>Handle</span>
                  <strong>@{onchainProfile.handle}</strong>
                </div>
                <div>
                  <span>Onchain Heat</span>
                  <strong>{onchainProfile.heat_score}</strong>
                </div>
                <div>
                  <span>Main Wallet</span>
                  <strong>{truncateAddress(onchainProfile.main_wallet)}</strong>
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => {
                    void handleSyncOnchainHeat();
                  }}
                  disabled={
                    isOnchainActionPending || !selectedWalletOnchainLinked
                  }
                >
                  {isOnchainActionPending ? "Working..." : "Sync heat"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    void handleLinkWalletOnchain();
                  }}
                  disabled={
                    isOnchainActionPending || !canLinkSelectedWalletOnchain
                  }
                >
                  {isOnchainActionPending
                    ? "Working..."
                    : "Link selected wallet onchain"}
                </button>
              </div>

              <div className={styles.walletList}>
                <h3>Onchain wallets</h3>
                {onchainWallets.map((wallet) => {
                  const isMainWallet =
                    wallet.toLowerCase() ===
                    onchainProfile.main_wallet.toLowerCase();

                  return (
                    <div key={wallet} className={styles.walletRow}>
                      <div>
                        <strong title={wallet}>{truncateAddress(wallet)}</strong>
                        <span>
                          {isMainWallet
                            ? "Main payout wallet"
                            : "Linked to your Memetics profile"}
                        </span>
                      </div>
                      {isMainWallet ? (
                        <span className={styles.inlineStatus}>Main</span>
                      ) : (
                        <button
                          type="button"
                          className={styles.unlinkButton}
                          onClick={() => {
                            void handleSetMainWalletOnchain(wallet);
                          }}
                          disabled={isOnchainActionPending}
                        >
                          Make main
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className={styles.helperCopy}>
                {selectedWalletOnchainLinked
                  ? `The selected transaction wallet is already linked onchain. You can use it to sync heat or change the main wallet.`
                  : `The selected transaction wallet is not linked onchain yet. Use "Link selected wallet onchain" if you want this signer available across claims, bungalow petitions, and Bodega installs.`}
              </p>
            </>
          ) : null}
        </section>

        <section className={styles.linkedWallets}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Linked External Wallets</h2>
              <p>
                {isWalletsLoading
                  ? "Loading linked wallets..."
                  : linkedWallets.length === 0
                    ? "No wallets linked yet. Add a wallet to start transacting on Jungle Bay Island."
                    : isMobileBrowser()
                      ? "Showing external linked wallets only."
                      : "Desktop wallet linking is optimized for in-browser EVM connectors."}
              </p>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                void handleAddWallet();
              }}
              disabled={isLinkingWallet}
            >
              {isLinkingWallet ? "Linking..." : "+ Add wallet"}
            </button>
          </div>

          {walletsError ? (
            <p className={styles.inlineError}>{walletsError}</p>
          ) : null}
          {walletActionError ? (
            <p className={styles.inlineError}>{walletActionError}</p>
          ) : null}
          {walletLinkStatus ? (
            <p className={styles.inlineStatus}>{walletLinkStatus}</p>
          ) : null}

          {isWalletsLoading ? (
            <p className={styles.placeholder}>.</p>
          ) : linkedWallets.length === 0 ? (
            <p className={styles.placeholder}>
              No wallets linked yet. Add a wallet to start transacting on Jungle
              Bay Island.
            </p>
          ) : (
            <div className={styles.walletList}>
              {linkedWallets.map((wallet) => (
                <div key={wallet.id} className={styles.walletRow}>
                  <div>
                    <strong title={wallet.address}>
                      {truncateAddress(wallet.address)}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className={styles.unlinkButton}
                    onClick={() => {
                      void handleUnlinkWallet(wallet.address);
                    }}
                    disabled={unlinkingWallet === wallet.address}
                  >
                    {unlinkingWallet === wallet.address ? "..." : "Unlink"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => navigate("/")}
          >
            Back to Map
          </button>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Logout
          </button>
        </div>
      </article>
    </section>
  );
}
