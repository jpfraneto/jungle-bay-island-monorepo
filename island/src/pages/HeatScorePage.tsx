import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Link, useOutletContext } from "react-router-dom";
import type { LayoutOutletContext } from "../components/Layout";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { formatAddress } from "../utils/formatters";
import styles from "../styles/heat-score-page.module.css";

interface WalletHeat {
  wallet: string;
  heat_degrees: number;
}

interface TokenBreakdownItem {
  token: string;
  token_name: string;
  token_symbol: string | null;
  chain: string | null;
  heat_degrees: number;
  wallet_heats?: WalletHeat[];
}

interface HeatScoreResponse {
  token_breakdown?: TokenBreakdownItem[];
  linked_wallets?: string[];
}

interface HeatTableRow {
  key: string;
  chain: string;
  tokenAddress: string;
  name: string;
  symbol: string | null;
  slug: string | null;
  listed: boolean;
  heat: number;
  walletHeats: WalletHeat[];
}

function normalizeHeat(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatHeat(value: number | null | undefined): string {
  const numeric = normalizeHeat(value);
  if (Math.abs(numeric) < 0.05) return "0.0°";
  return `${numeric.toFixed(1)}°`;
}

function chainLabel(chain: string | null | undefined): string {
  if (chain === "base") return "Base";
  if (chain === "ethereum") return "Ethereum";
  if (chain === "solana") return "Solana";
  return "Unknown";
}

function getTierFromHeat(heat: number): string {
  if (heat >= 250) return "Elder";
  if (heat >= 150) return "Builder";
  if (heat >= 80) return "Resident";
  if (heat >= 30) return "Observer";
  return "Drifter";
}

function normalizeTokenKey(
  chain: string | null | undefined,
  tokenAddress: string | null | undefined,
): string {
  const normalizedChain = chain ?? "unknown";
  const normalizedToken =
    normalizedChain === "solana"
      ? tokenAddress?.trim() ?? ""
      : tokenAddress?.trim().toLowerCase() ?? "";
  return `${normalizedChain}:${normalizedToken}`;
}

function normalizeWalletRows(input: WalletHeat[] | undefined): WalletHeat[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((entry) => ({
      wallet: typeof entry.wallet === "string" ? entry.wallet : "",
      heat_degrees: normalizeHeat(entry.heat_degrees),
    }))
    .filter((entry) => entry.wallet.length > 0)
    .sort((left, right) => right.heat_degrees - left.heat_degrees);
}

export default function HeatScorePage() {
  const { authenticated, login, user } = usePrivy();
  const isXAuthenticated =
    authenticated &&
    typeof user?.twitter?.username === "string" &&
    user.twitter.username.trim().length > 0;
  const { walletAddress } = usePrivyBaseWallet();
  const { wallets: linkedWalletRows } = useUserWalletLinks(isXAuthenticated);
  const { bungalows } = useOutletContext<LayoutOutletContext>();
  const [profile, setProfile] = useState<HeatScoreResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupWallet = linkedWalletRows[0]?.address ?? walletAddress ?? "";

  useEffect(() => {
    if (!isXAuthenticated || !lookupWallet) {
      setProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/wallet/${encodeURIComponent(lookupWallet)}?aggregate=true`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const data = (await response.json()) as HeatScoreResponse;
        setProfile(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        setProfile(null);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load your heat breakdown",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [isXAuthenticated, lookupWallet]);

  const tableRows = useMemo(() => {
    const tokenBreakdown = Array.isArray(profile?.token_breakdown)
      ? profile.token_breakdown
      : [];
    const breakdownByKey = new Map<string, TokenBreakdownItem>();

    for (const row of tokenBreakdown) {
      breakdownByKey.set(normalizeTokenKey(row.chain, row.token), row);
    }

    const listedRows: HeatTableRow[] = bungalows.map((bungalow) => {
      const key = normalizeTokenKey(bungalow.chain, bungalow.token_address);
      const match = breakdownByKey.get(key);
      breakdownByKey.delete(key);

      return {
        key,
        chain: bungalow.chain,
        tokenAddress: bungalow.token_address,
        name: bungalow.name ?? bungalow.symbol ?? bungalow.token_address,
        symbol: bungalow.symbol ?? null,
        slug: bungalow.canonical_slug ?? bungalow.token_address,
        listed: true,
        heat: normalizeHeat(match?.heat_degrees),
        walletHeats: normalizeWalletRows(match?.wallet_heats),
      };
    });

    const extraRows: HeatTableRow[] = Array.from(breakdownByKey.values()).map(
      (row) => ({
        key: normalizeTokenKey(row.chain, row.token),
        chain: row.chain ?? "unknown",
        tokenAddress: row.token,
        name: row.token_name ?? row.token_symbol ?? row.token,
        symbol: row.token_symbol ?? null,
        slug: row.token,
        listed: false,
        heat: normalizeHeat(row.heat_degrees),
        walletHeats: normalizeWalletRows(row.wallet_heats),
      }),
    );

    return [...listedRows, ...extraRows].sort((left, right) => {
      const heatDifference = right.heat - left.heat;
      if (Math.abs(heatDifference) > 0.001) {
        return heatDifference;
      }

      const leftLabel = left.symbol ?? left.name;
      const rightLabel = right.symbol ?? right.name;
      return leftLabel.localeCompare(rightLabel);
    });
  }, [bungalows, profile?.token_breakdown]);

  const clusterWallets = useMemo(() => {
    const merged = [
      ...(profile?.linked_wallets ?? []),
      ...linkedWalletRows.map((row) => row.address),
      walletAddress ?? "",
    ].filter((value): value is string => value.length > 0);

    return [...new Set(merged)];
  }, [linkedWalletRows, profile?.linked_wallets, walletAddress]);

  const overallHeat = useMemo(
    () => tableRows.reduce((sum, row) => sum + row.heat, 0),
    [tableRows],
  );
  const activeBungalows = tableRows.filter((row) => row.heat > 0.05).length;
  const tier = getTierFromHeat(overallHeat);

  return (
    <section className={styles.page}>
      <article className={styles.hero}>
        <div>
          <p className={styles.kicker}>Heat Score</p>
          <h1>Your Island Heat</h1>
          <p className={styles.summary}>
            Overall heat is the sum of every linked wallet contribution across
            each scanned bungalow. If two of your wallets earn heat on the same
            token, this page adds them together on that bungalow row before it
            rolls into your island total.
          </p>
        </div>
        {!isXAuthenticated ? (
          <button
            type="button"
            className={styles.connectButton}
            onClick={() => login()}
          >
            Sign in with X
          </button>
        ) : null}
      </article>

      <article className={styles.liveCard}>
        <div className={styles.metricGrid}>
          <div className={styles.metricCard}>
            <span>Overall Heat</span>
            <strong>{formatHeat(overallHeat)}</strong>
            <small>Sum of all bungalow rows</small>
          </div>
          <div className={styles.metricCard}>
            <span>Tier</span>
            <strong>{tier}</strong>
            <small>Based on your current total</small>
          </div>
          <div className={styles.metricCard}>
            <span>Bungalows With Heat</span>
            <strong>{activeBungalows}</strong>
            <small>Rows above 0.0 degrees</small>
          </div>
          <div className={styles.metricCard}>
            <span>Wallets Counted</span>
            <strong>{clusterWallets.length}</strong>
            <small>Linked wallets in this cluster</small>
          </div>
        </div>

        <div className={styles.walletCluster}>
          <span className={styles.walletLabel}>Wallet cluster</span>
          <div className={styles.walletPills}>
            {clusterWallets.length > 0 ? (
              clusterWallets.map((wallet) => (
                <span key={wallet} className={styles.walletPill}>
                  {formatAddress(wallet)}
                </span>
              ))
            ) : (
              <span className={styles.walletPillMuted}>
                {isXAuthenticated
                  ? "No linked wallets found yet."
                  : "Sign in with X to load your live breakdown."}
              </span>
            )}
          </div>
        </div>

        {!isXAuthenticated ? (
          <div className={styles.statusCard}>
            Sign in with X to see your live overall heat and bungalow-by-bungalow breakdown.
          </div>
        ) : null}

        {isXAuthenticated && isLoading ? (
          <div className={styles.statusCard}>Loading your heat breakdown...</div>
        ) : null}

        {isXAuthenticated && error ? (
          <div className={styles.errorCard}>{error}</div>
        ) : null}

        <div className={styles.tableWrap}>
          <table className={styles.breakdownTable}>
            <thead>
              <tr>
                <th>Bungalow</th>
                <th>Wallet Contributions</th>
                <th>Total Heat</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const positiveWallets = row.walletHeats.filter(
                  (entry) => entry.heat_degrees > 0.05,
                );

                return (
                  <tr key={row.key}>
                    <td>
                      {row.listed ? (
                        <Link
                          to={`/bungalow/${row.slug ?? row.tokenAddress}`}
                          className={styles.rowLink}
                        >
                          {row.symbol ? `$${row.symbol}` : row.name}
                        </Link>
                      ) : (
                        <span className={styles.rowLinkMuted}>
                          {row.symbol ? `$${row.symbol}` : row.name}
                        </span>
                      )}
                      <span className={styles.rowMeta}>
                        {chainLabel(row.chain)} • {row.name}
                      </span>
                    </td>
                    <td>
                      {positiveWallets.length > 0 ? (
                        <div className={styles.walletStack}>
                          {positiveWallets.map((entry) => (
                            <span
                              key={`${row.key}:${entry.wallet}`}
                              className={styles.walletLine}
                            >
                              <span className={styles.walletAddress}>
                                {formatAddress(entry.wallet)}
                              </span>
                              <b className={styles.walletHeat}>
                                {formatHeat(entry.heat_degrees)}
                              </b>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.emptyCell}>
                          No heat from your linked wallets
                        </span>
                      )}
                    </td>
                    <td
                      className={`${styles.heatCell} ${
                        row.heat <= 0.05 ? styles.zeroHeat : ""
                      }`}
                    >
                      {formatHeat(row.heat)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className={styles.card}>
        <h2 className={styles.subheading}>The Math</h2>
        <p>
          Heat starts with a wallet&apos;s{" "}
          <strong>Time-Weighted Average Balance (TWAB)</strong>. Instead of
          looking at one snapshot balance, Jungle Bay averages how long and how
          consistently you held the token across the scan window.
        </p>

        <div className={styles.formula}>
          <div className={styles.equation}>
            <span className={styles.symbol}>TWAB</span>
            <span className={styles.equals}>=</span>
            <span className={styles.fraction}>
              <span className={styles.numerator}>1</span>
              <span className={styles.denominator}>T</span>
            </span>
            <span className={styles.sigma}>
              &Sigma;<sub>i</sub>
            </span>
            <span className={styles.term}>
              balance<sub>i</sub>&nbsp;&Delta;t<sub>i</sub>
            </span>
          </div>
        </div>

        <p className={styles.formulaDesc}>
          Each bungalow row on this page is the sum of the adjusted heat earned
          by every wallet in your linked cluster for that token.
        </p>

        <div className={styles.formula}>
          <div className={styles.equation}>
            <span className={styles.symbol}>Heat</span>
            <span className={styles.equals}>=</span>
            <span>100</span>
            <span className={styles.dot}>&middot;</span>
            <span>(</span>
            <span>1</span>
            <span className={styles.minus}>&minus;</span>
            <span>
              e
              <sup className={styles.exponent}>
                &minus;60 &middot; TWAB / totalSupply
              </sup>
            </span>
            <span>)</span>
          </div>
        </div>

        <h2 className={styles.subheading}>Island Tiers</h2>
        <table className={styles.tierTable}>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Island Heat</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Elder</td>
              <td>250+</td>
              <td>Deep continuity across the island</td>
            </tr>
            <tr>
              <td>Builder</td>
              <td>150-249</td>
              <td>Strong sustained presence</td>
            </tr>
            <tr>
              <td>Resident</td>
              <td>80-149</td>
              <td>Established alignment</td>
            </tr>
            <tr>
              <td>Observer</td>
              <td>30-79</td>
              <td>Early but visible signal</td>
            </tr>
            <tr>
              <td>Drifter</td>
              <td>Below 30</td>
              <td>Light contact with the territory</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>
  );
}
