import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useSiweWalletLink } from "../hooks/useSiweWalletLink";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { formatAddress, formatNumber } from "../utils/formatters";
import styles from "../styles/profile-page.module.css";

interface UserProfileResponse {
  island_heat?: number;
  tier?: string;
  token_breakdown?: unknown[];
  scans?: unknown[];
  x_username?: string | null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatLinkedDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Linked";

  return `Linked ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(parsed))}`;
}

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, "").toLowerCase();
  return clean ? `@${clean}` : "";
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const {
    authenticated,
    getAccessToken,
    linkTwitter,
    login,
    logout,
    unlinkTwitter,
    user,
  } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const {
    wallets: linkedWallets,
    isLoading: isWalletsLoading,
    error: walletsError,
    refetch: refetchWallets,
  } = useUserWalletLinks(authenticated);
  const {
    linkCurrentWallet,
    isLinking,
    status: linkStatus,
    error: linkError,
  } = useSiweWalletLink();

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unlinkingWallet, setUnlinkingWallet] = useState<string | null>(null);
  const [walletActionError, setWalletActionError] = useState<string | null>(null);
  const [isLinkingX, setIsLinkingX] = useState(false);
  const [xError, setXError] = useState<string | null>(null);
  const [claimedXUsername, setClaimedXUsername] = useState<string | null>(null);
  const [pendingTwitterSync, setPendingTwitterSync] = useState(false);

  useEffect(() => {
    setClaimedXUsername((current) => {
      if (current) return current;

      const fromProfile =
        typeof profile?.x_username === "string" ? profile.x_username : null;
      if (fromProfile && fromProfile.trim().length > 0) {
        return normalizeXUsername(fromProfile);
      }

      const fromUser =
        typeof user?.twitter?.username === "string" ? user.twitter.username : "";
      const normalized = normalizeXUsername(fromUser);
      return normalized || null;
    });
  }, [profile?.x_username, user?.twitter?.username]);

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
        setXError(err instanceof Error ? err.message : "Failed to link X account");
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

  const handleAddWallet = async () => {
    try {
      await linkCurrentWallet();
      await refetchWallets();
      setWalletActionError(null);
    } catch {
      // useSiweWalletLink already provides error state text.
    }
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
      setXError(err instanceof Error ? err.message : "Failed to unlink X account");
    }
  };

  if (!authenticated) {
    return (
      <section className={styles.page}>
        <article className={styles.card}>
          <h1>Profile</h1>
          <p>Connect your account to view your profile.</p>
          <button
            type="button"
            className={styles.actionButton}
            onClick={login}
          >
            Connect
          </button>
        </article>
      </section>
    );
  }

  const islandHeat = Number(profile?.island_heat ?? 0);
  const tier = profile?.tier ?? "drifter";
  const tokensTracked = asArray(profile?.token_breakdown).length;
  const scansCount = asArray(profile?.scans).length;
  const isEmailLoginUser = Boolean(user?.email);
  const isXLoginUser = Boolean(user?.twitter) && !user?.email;
  const emailClaimedHandle = claimedXUsername || null;

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Profile</h1>

        <div className={styles.identity}>
          <strong>{user?.email?.address ?? "Island User"}</strong>
          <span>{walletAddress ? formatAddress(walletAddress) : "No active wallet"}</span>
        </div>

        <div className={styles.stats}>
          <div>
            <span>Island Heat</span>
            <strong>{isLoading ? "..." : `${islandHeat.toFixed(1)}°`}</strong>
          </div>
          <div>
            <span>Tier</span>
            <strong>{isLoading ? "..." : tier}</strong>
          </div>
          <div>
            <span>Tokens Tracked</span>
            <strong>{isLoading ? "..." : formatNumber(tokensTracked)}</strong>
          </div>
          <div>
            <span>Scans</span>
            <strong>{isLoading ? "..." : formatNumber(scansCount)}</strong>
          </div>
          <div>
            <span>Linked Wallets</span>
            <strong>
              {isWalletsLoading ? "..." : formatNumber(linkedWallets.length)}
            </strong>
          </div>
        </div>

        <section className={styles.linkedWallets}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Linked Wallets</h2>
              <p>
                No wallets linked yet. Add a wallet to start transacting on
                Jungle Bay Island.
              </p>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                void handleAddWallet();
              }}
              disabled={isLinking}
            >
              {isLinking ? "Linking..." : "+ Add wallet"}
            </button>
          </div>

          {walletsError ? <p className={styles.inlineError}>{walletsError}</p> : null}
          {walletActionError ? (
            <p className={styles.inlineError}>{walletActionError}</p>
          ) : null}
          {linkStatus ? <p className={styles.inlineStatus}>{linkStatus}</p> : null}
          {linkError ? <p className={styles.inlineError}>{linkError}</p> : null}

          {isWalletsLoading ? (
            <p className={styles.placeholder}>Loading linked wallets...</p>
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
                    <strong title={wallet.address}>{truncateAddress(wallet.address)}</strong>
                    <span>SIWE verified</span>
                    <span>{formatLinkedDate(wallet.linked_at)}</span>
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
                  <strong>[X logo icon] Claim your handle</strong>
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
                  <strong>[X logo icon] {emailClaimedHandle}</strong>
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
                  [X logo icon] @{user?.twitter?.username ?? "unknown"} ✓ Verified via
                  login
                </strong>
              </div>
            </div>
          </section>
        ) : null}

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
