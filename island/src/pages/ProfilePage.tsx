import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import MiningZones from "../components/MiningZones";
import { formatAddress, formatNumber, formatTimeAgo } from "../utils/formatters";
import styles from "../styles/profile-page.module.css";

interface UserProfileResponse {
  island_heat?: number;
  tier?: string;
  farcaster?: {
    username?: string | null;
    display_name?: string | null;
  } | null;
  token_breakdown?: unknown[];
  scans?: unknown[];
}

interface WalletLinkRow {
  id: number;
  primary_wallet: string;
  linked_wallet: string;
  verification_signature: string;
  verification_message: string;
  created_at: string;
}

interface WalletLinksResponse {
  wallet?: unknown;
  linked_wallets?: unknown[];
  linked_under?: unknown[];
  cluster?: {
    wallets?: unknown[];
  } | null;
  error?: unknown;
}

interface EthereumRequestProvider {
  request(args: {
    method: string;
    params?: unknown[];
  }): Promise<unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Normalizes wallet link API rows so the profile UI can render them safely.
 */
function normalizeWalletLinks(input: unknown): WalletLinkRow[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw) => {
      const item = asObject(raw);
      if (!item) return null;

      const id = asNumber(item.id);
      const primaryWallet = asString(item.primary_wallet);
      const linkedWallet = asString(item.linked_wallet);

      if (!id || !primaryWallet || !linkedWallet) {
        return null;
      }

      return {
        id,
        primary_wallet: primaryWallet,
        linked_wallet: linkedWallet,
        verification_signature: asString(item.verification_signature),
        verification_message: asString(item.verification_message),
        created_at: asString(item.created_at),
      };
    })
    .filter((item): item is WalletLinkRow => item !== null);
}

/**
 * Builds the exact verification message shape the wallet-link backend expects.
 */
function buildLinkMessage(
  primaryWallet: string,
  linkedWallet: string,
  timestamp: number,
): string {
  return `I am linking ${linkedWallet} to my Jungle Bay Island profile ${primaryWallet}. Timestamp: ${timestamp}`;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { authenticated, connectWallet, getAccessToken, login, logout, user } =
    usePrivy();
  const { wallets } = useWallets();

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [links, setLinks] = useState<WalletLinkRow[]>([]);
  const [linkedUnder, setLinkedUnder] = useState<WalletLinkRow[]>([]);
  const [identityClusterCount, setIdentityClusterCount] = useState(0);
  const [isLinksLoading, setIsLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [isLinkPanelOpen, setIsLinkPanelOpen] = useState(false);
  const [linkMode, setLinkMode] = useState<"connected" | "manual">("connected");
  const [selectedLinkedWallet, setSelectedLinkedWallet] = useState("");
  const [manualLinkedWallet, setManualLinkedWallet] = useState("");
  const [manualSignature, setManualSignature] = useState("");
  const [linkTimestamp, setLinkTimestamp] = useState(() => Date.now());
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [unlinkingWallet, setUnlinkingWallet] = useState<string | null>(null);

  const walletAddress = useMemo(() => {
    if (user?.wallet?.address) return user.wallet.address;
    if (wallets.length > 0) return wallets[0].address;
    return "";
  }, [user, wallets]);

  const connectedSecondaryWallets = useMemo(
    () =>
      wallets.filter(
        (wallet) => wallet.address.toLowerCase() !== walletAddress.toLowerCase(),
      ),
    [walletAddress, wallets],
  );

  const activeLinkTarget =
    linkMode === "manual"
      ? manualLinkedWallet.trim()
      : selectedLinkedWallet.trim();
  const linkMessage =
    walletAddress && activeLinkTarget
      ? buildLinkMessage(walletAddress, activeLinkTarget, linkTimestamp)
      : "";

  const fetchLinkedWallets = useCallback(async () => {
    if (!walletAddress) {
      setLinks([]);
      setLinkedUnder([]);
      setIdentityClusterCount(0);
      setIsLinksLoading(false);
      setLinksError(null);
      return;
    }

    setIsLinksLoading(true);
    setLinksError(null);

    try {
      const response = await fetch(`/api/wallet/links/${encodeURIComponent(walletAddress)}`, {
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as
        | WalletLinksResponse
        | null;

      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      const normalizedLinks = normalizeWalletLinks(data?.linked_wallets);
      const normalizedLinkedUnder = normalizeWalletLinks(data?.linked_under);
      const clusterWallets = asArray(data?.cluster?.wallets).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );

      setLinks(normalizedLinks);
      setLinkedUnder(normalizedLinkedUnder);
      setIdentityClusterCount(
        clusterWallets.length > 0 ? clusterWallets.length : normalizedLinks.length + 1,
      );
    } catch (err) {
      setLinks([]);
      setLinkedUnder([]);
      setIdentityClusterCount(0);
      setLinksError(
        err instanceof Error ? err.message : "Failed to load linked wallets",
      );
    } finally {
      setIsLinksLoading(false);
    }
  }, [walletAddress]);

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

  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setLinks([]);
      setLinkedUnder([]);
      setIdentityClusterCount(0);
      setIsLinksLoading(false);
      setLinksError(null);
      return;
    }

    void fetchLinkedWallets();
  }, [authenticated, fetchLinkedWallets, walletAddress]);

  useEffect(() => {
    if (!isLinkPanelOpen || linkMode !== "connected") return;
    if (!selectedLinkedWallet && connectedSecondaryWallets[0]) {
      setSelectedLinkedWallet(connectedSecondaryWallets[0].address);
    }
  }, [connectedSecondaryWallets, isLinkPanelOpen, linkMode, selectedLinkedWallet]);

  if (!authenticated) {
    return (
      <section className={styles.page}>
        <article className={styles.card}>
          <h1>Profile</h1>
          <p>Connect your wallet to view your profile.</p>
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

  const displayName =
    profile?.farcaster?.display_name ??
    profile?.farcaster?.username ??
    "Island User";
  const islandHeat = Number(profile?.island_heat ?? 0);
  const tier = profile?.tier ?? "drifter";
  const tokensTracked = asArray(profile?.token_breakdown).length;
  const scansCount = asArray(profile?.scans).length;

  const handleLinkWallet = async () => {
    if (!walletAddress) {
      setLinkError("Connect a primary wallet first.");
      return;
    }

    const linkedWallet =
      linkMode === "manual"
        ? manualLinkedWallet.trim()
        : selectedLinkedWallet.trim();

    if (!linkedWallet) {
      setLinkError("Choose or enter a wallet to link.");
      return;
    }

    setIsLinking(true);
    setLinkStatus(null);
    setLinkError(null);

    try {
      const timestamp = Date.now();
      setLinkTimestamp(timestamp);
      const message = buildLinkMessage(walletAddress, linkedWallet, timestamp);
      let signature = manualSignature.trim();

      if (linkMode === "connected") {
        const candidate = connectedSecondaryWallets.find(
          (wallet) => wallet.address.toLowerCase() === linkedWallet.toLowerCase(),
        );

        if (!candidate) {
          throw new Error(
            "Connect the wallet you want to link first, then try again.",
          );
        }

        const provider =
          (await candidate.getEthereumProvider()) as EthereumRequestProvider;
        const signed = await provider.request({
          method: "personal_sign",
          params: [message, linkedWallet],
        });

        if (typeof signed !== "string" || signed.trim().length === 0) {
          throw new Error("Wallet signature was not returned.");
        }

        signature = signed;
      } else if (!signature) {
        throw new Error("Paste the signature produced by the wallet you are linking.");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/wallet/link", {
        method: "POST",
        headers,
        body: JSON.stringify({
          linked_wallet: linkedWallet,
          signature,
          message,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            error?: unknown;
          }
        | null;

      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      setManualLinkedWallet("");
      setManualSignature("");
      setSelectedLinkedWallet("");
      setIsLinkPanelOpen(false);
      setLinkStatus("Linked wallet added to your island identity.");
      await fetchLinkedWallets();
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : "Failed to link wallet",
      );
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlinkWallet = async (linkedWallet: string) => {
    setUnlinkingWallet(linkedWallet);
    setLinksError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/wallet/link", {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          linked_wallet: linkedWallet,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            error?: unknown;
          }
        | null;

      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      await fetchLinkedWallets();
    } catch (err) {
      setLinksError(
        err instanceof Error ? err.message : "Failed to unlink wallet",
      );
    } finally {
      setUnlinkingWallet(null);
    }
  };

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Profile</h1>

        <div className={styles.identity}>
          <strong>{displayName}</strong>
          <span>{walletAddress ? formatAddress(walletAddress) : "No wallet"}</span>
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
            <span>Connected Wallets</span>
            <strong>{formatNumber(wallets.length)}</strong>
          </div>
          <div>
            <span>Identity Cluster</span>
            <strong>
              {isLinksLoading ? "..." : formatNumber(identityClusterCount || 1)}
            </strong>
          </div>
        </div>

        <section className={styles.linkedWallets}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Linked Wallets</h2>
              <p>
                Heat and holdings can roll up across linked wallets. If your
                token lives in cold storage, link it here.
              </p>
            </div>
            <button
              type="button"
              className={styles.sectionButton}
              onClick={() => {
                setIsLinkPanelOpen((current) => !current);
                setLinkStatus(null);
                setLinkError(null);
                setLinkTimestamp(Date.now());
              }}
            >
              {isLinkPanelOpen ? "Close" : "+ Link another wallet"}
            </button>
          </div>

          {linksError ? <p className={styles.inlineError}>{linksError}</p> : null}
          {linkStatus ? <p className={styles.inlineStatus}>{linkStatus}</p> : null}

          {isLinkPanelOpen ? (
            <div className={styles.linkComposer}>
              <div className={styles.modeRow}>
                <button
                  type="button"
                  className={`${styles.modeButton} ${
                    linkMode === "connected" ? styles.modeButtonActive : ""
                  }`}
                  onClick={() => {
                    setLinkMode("connected");
                    setLinkError(null);
                    setLinkTimestamp(Date.now());
                  }}
                >
                  Connected wallet
                </button>
                <button
                  type="button"
                  className={`${styles.modeButton} ${
                    linkMode === "manual" ? styles.modeButtonActive : ""
                  }`}
                  onClick={() => {
                    setLinkMode("manual");
                    setLinkError(null);
                    setLinkTimestamp(Date.now());
                  }}
                >
                  Manual proof
                </button>
              </div>

              {linkMode === "connected" ? (
                <div className={styles.composerGrid}>
                  <label className={styles.field}>
                    Wallet to link
                    <select
                      value={selectedLinkedWallet}
                      onChange={(event) => {
                        setSelectedLinkedWallet(event.target.value);
                        setLinkTimestamp(Date.now());
                      }}
                    >
                      <option value="">Choose a connected wallet</option>
                      {connectedSecondaryWallets.map((wallet) => (
                        <option key={wallet.address} value={wallet.address}>
                          {wallet.address}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.inlineActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => connectWallet({ walletChainType: "ethereum-only" })}
                    >
                      Connect another wallet
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.composerGrid}>
                  <label className={styles.field}>
                    Linked wallet address
                    <input
                      value={manualLinkedWallet}
                      onChange={(event) => {
                        setManualLinkedWallet(event.target.value);
                        setLinkTimestamp(Date.now());
                      }}
                      placeholder="0x... or Solana address"
                    />
                  </label>
                  <label className={styles.field}>
                    Signature
                    <textarea
                      value={manualSignature}
                      onChange={(event) => setManualSignature(event.target.value)}
                      rows={3}
                      placeholder="Paste the signature produced by the linked wallet"
                    />
                  </label>
                </div>
              )}

              <label className={styles.field}>
                Verification message
                <textarea
                  value={linkMessage}
                  readOnly
                  rows={3}
                />
                <small>
                  {linkMode === "connected"
                    ? "This will be signed by the linked wallet with no transaction."
                    : "Sign this message in the wallet you are linking, then paste the signature above."}
                </small>
              </label>

              {linkError ? <p className={styles.inlineError}>{linkError}</p> : null}

              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleLinkWallet}
                  disabled={isLinking}
                >
                  {isLinking ? "Linking..." : "Link wallet"}
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.walletLists}>
            <div className={styles.walletList}>
              <h3>Linked to this profile</h3>
              {isLinksLoading ? (
                <p className={styles.placeholder}>Loading linked wallets...</p>
              ) : links.length === 0 ? (
                <p className={styles.placeholder}>No extra wallets linked yet.</p>
              ) : (
                links.map((link) => (
                  <div key={link.id} className={styles.walletRow}>
                    <div>
                      <strong>{formatAddress(link.linked_wallet)}</strong>
                      <span>Linked {formatTimeAgo(link.created_at)}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.unlinkButton}
                      onClick={() => handleUnlinkWallet(link.linked_wallet)}
                      disabled={unlinkingWallet === link.linked_wallet}
                    >
                      {unlinkingWallet === link.linked_wallet ? "..." : "Unlink"}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className={styles.walletList}>
              <h3>Also linked under</h3>
              {isLinksLoading ? (
                <p className={styles.placeholder}>Loading reverse links...</p>
              ) : linkedUnder.length === 0 ? (
                <p className={styles.placeholder}>
                  This wallet is not currently nested under another primary wallet.
                </p>
              ) : (
                linkedUnder.map((link) => (
                  <div key={link.id} className={styles.walletRow}>
                    <div>
                      <strong>{formatAddress(link.primary_wallet)}</strong>
                      <span>Primary profile</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <MiningZones heat={islandHeat} />

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
