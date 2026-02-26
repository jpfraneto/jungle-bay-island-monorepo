import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { formatAddress, formatNumber } from "../utils/formatters";
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const walletAddress = useMemo(() => {
    if (user?.wallet?.address) return user.wallet.address;
    if (wallets.length > 0) return wallets[0].address;
    return "";
  }, [user, wallets]);

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
        </div>

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
