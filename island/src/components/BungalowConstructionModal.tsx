import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import styles from "../styles/bungalow-construction-modal.module.css";

interface BungalowConstructionModalProps {
  open: boolean;
  onClose: () => void;
}

interface QualificationResponse {
  token_address: string;
  chain: string;
  exists: boolean;
  canonical_path?: string | null;
  construction_fee_jbm: string;
  thresholds: {
    submit_heat_min: number;
    support_heat_min: number;
    single_builder_heat_min: number;
    required_supporters: number;
    jbac_shortcut_min_balance: string;
    steward_heat_min: number;
  };
  support: {
    supporter_count: number;
    required_supporters: number;
    has_supported: boolean;
    community_support_ready: boolean;
  };
  viewer: {
    island_heat: number;
    jbac_balance: string;
    has_supported: boolean;
    can_submit_to_bungalow: boolean;
    can_support: boolean;
    qualifies_to_construct_now: boolean;
    qualification_path: string | null;
  } | null;
  token: {
    name: string | null;
    symbol: string | null;
    image_url: string | null;
  };
}

function formatPathLabel(path: string | null | undefined): string {
  if (path === "single_hot_wallet") return "Single high-heat builder";
  if (path === "community_support") return "Community support";
  if (path === "jbac_shortcut") return "10+ Jungle Bay Apes shortcut";
  return "Not qualified yet";
}

export default function BungalowConstructionModal({
  open,
  onClose,
}: BungalowConstructionModalProps) {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { wallets: linkedWalletRows } = useUserWalletLinks(authenticated);
  const { transfer, isTransferring } = useJBMTransfer();

  const [chain, setChain] = useState("base");
  const [ca, setCa] = useState("");
  const [qualification, setQualification] =
    useState<QualificationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const [isConstructing, setIsConstructing] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewerWallet = linkedWalletRows[0]?.address ?? walletAddress ?? "";

  useEffect(() => {
    if (!open) return;

    setChain("base");
    setCa("");
    setQualification(null);
    setIsLoading(false);
    setIsSubmittingSupport(false);
    setIsConstructing(false);
    setPendingTxHash(null);
    setStatus(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  if (!open) return null;

  const loadQualification = async () => {
    const trimmedCa = ca.trim();
    if (!trimmedCa) {
      setError("Enter a contract address first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus(null);

    try {
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `/api/bungalow/${encodeURIComponent(chain)}/${encodeURIComponent(trimmedCa)}/qualification${
          viewerWallet
            ? `?viewer_wallet=${encodeURIComponent(viewerWallet)}`
            : ""
        }`,
        {
          headers,
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => null)) as
        | QualificationResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          typeof (data as { error?: string } | null)?.error === "string"
            ? (data as { error?: string }).error
            : `Request failed (${response.status})`,
        );
      }

      setQualification(data as QualificationResponse);
    } catch (err) {
      setQualification(null);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load bungalow qualification",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSupport = async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (!qualification) return;

    setIsSubmittingSupport(true);
    setError(null);
    setStatus("Submitting your support...");

    try {
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `/api/bungalow/${encodeURIComponent(qualification.chain)}/${encodeURIComponent(qualification.token_address)}/support`,
        {
          method: "POST",
          headers,
        },
      );
      const data = (await response.json().catch(() => null)) as
        | QualificationResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          typeof (data as { error?: string } | null)?.error === "string"
            ? (data as { error?: string }).error
            : `Request failed (${response.status})`,
        );
      }

      setQualification(data as QualificationResponse);
      setStatus("Support recorded.");
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Failed to submit support");
    } finally {
      setIsSubmittingSupport(false);
    }
  };

  const handleConstruct = async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (!qualification) return;

    setIsConstructing(true);
    setError(null);

    try {
      let txHash = pendingTxHash;
      if (!txHash) {
        setStatus("Waiting for construction fee confirmation...");
        const transferResult = await transfer(
          Number(qualification.construction_fee_jbm),
        );
        txHash = transferResult.hash;
        setPendingTxHash(txHash);
      }

      setStatus("Opening the bungalow on the island...");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `/api/bungalow/${encodeURIComponent(qualification.chain)}/${encodeURIComponent(qualification.token_address)}/construct`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            tx_hash: txHash,
            jbm_amount: qualification.construction_fee_jbm,
          }),
        },
      );

      const data = (await response.json().catch(() => null)) as {
        bungalow?: {
          canonical_path?: string | null;
          token_address?: string;
        };
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${response.status})`,
        );
      }

      const destination =
        data?.bungalow?.canonical_path ||
        qualification.canonical_path ||
        `/bungalow/${qualification.token_address}`;

      setPendingTxHash(null);
      setStatus("Bungalow opened.");
      navigate(destination);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to construct bungalow";
      setStatus(null);
      if (pendingTxHash) {
        setError(
          `${message}. The fee transfer is already confirmed, so you can retry without paying again.`,
        );
      } else {
        setError(message);
      }
    } finally {
      setIsConstructing(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>New Bungalow</p>
            <h3>Open a new community bungalow</h3>
            <p className={styles.summary}>
              You can open a bungalow on the island if you have enough heat,
              support, or{" "}
              <a
                href="https://opensea.io/collection/junglebay"
                target="_blank"
                rel="noopener noreferrer"
              >
                Jungle Bay Apes
              </a>
              .
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <section className={styles.formRow}>
          <label className={styles.field}>
            Chain
            <select
              value={chain}
              onChange={(event) => setChain(event.target.value)}
            >
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
              <option value="solana">Solana</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.addressField}`}>
            Contract address
            <input
              value={ca}
              onChange={(event) => setCa(event.target.value)}
              placeholder="Paste the contract address"
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              void loadQualification();
            }}
            disabled={isLoading}
          >
            {isLoading ? "Checking..." : "Check qualification"}
          </button>
        </section>

        {qualification ? (
          <section className={styles.panel}>
            <div className={styles.tokenRow}>
              <div>
                <strong>
                  {qualification.token.symbol ||
                    qualification.token.name ||
                    qualification.token_address}
                </strong>
                <span>
                  {qualification.token.name || qualification.token_address}
                </span>
              </div>
              <div className={styles.pathPill}>
                {formatPathLabel(qualification.viewer?.qualification_path)}
              </div>
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}>
                <span>Community support</span>
                <strong>
                  {qualification.support.supporter_count}/
                  {qualification.support.required_supporters}
                </strong>
              </div>
              <div className={styles.metricCard}>
                <span>Construction fee</span>
                <strong>{qualification.construction_fee_jbm} JBM</strong>
              </div>
              <div className={styles.metricCard}>
                <span>Your island heat</span>
                <strong>
                  {qualification.viewer
                    ? qualification.viewer.island_heat.toFixed(1)
                    : viewerWallet
                      ? "Unavailable"
                      : "Connect wallet"}
                </strong>
              </div>
              <div className={styles.metricCard}>
                <span>Your JBAC balance</span>
                <strong>
                  {qualification.viewer
                    ? qualification.viewer.jbac_balance
                    : viewerWallet
                      ? "Unavailable"
                      : "Connect wallet"}
                </strong>
              </div>
            </div>

            <div className={styles.rules}>
              <p>
                One builder can open it if they have{" "}
                {qualification.thresholds.single_builder_heat_min}+ island heat.
              </p>
              <p>
                Or {qualification.thresholds.required_supporters} residents with{" "}
                {qualification.thresholds.support_heat_min}+ heat can back the
                same CA.
              </p>
              <p>
                Shortcut: hold{" "}
                {qualification.thresholds.jbac_shortcut_min_balance}+ Jungle Bay
                Apes.
              </p>
            </div>

            {qualification.exists ? (
              <div className={styles.notice}>
                This bungalow is already open on the island.
                {qualification.canonical_path ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className={styles.inlineLink}
                      onClick={() => {
                        navigate(qualification.canonical_path ?? "/");
                        onClose();
                      }}
                    >
                      Open it
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {!authenticated ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => login()}
              >
                Connect wallet to back or open this bungalow
              </button>
            ) : null}

            {authenticated &&
            qualification.viewer?.can_support &&
            !qualification.support.has_supported &&
            !qualification.exists ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void handleSupport();
                }}
                disabled={isSubmittingSupport || isConstructing}
              >
                {isSubmittingSupport ? "Backing..." : "Back this contract"}
              </button>
            ) : null}

            {authenticated &&
            qualification.viewer?.qualifies_to_construct_now &&
            !qualification.exists ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  void handleConstruct();
                }}
                disabled={
                  isConstructing || isSubmittingSupport || isTransferring
                }
              >
                {isConstructing || isTransferring
                  ? "Processing..."
                  : pendingTxHash
                    ? "Retry open bungalow"
                    : `Pay ${qualification.construction_fee_jbm} JBM & Open`}
              </button>
            ) : null}
          </section>
        ) : null}

        {status ? <div className={styles.status}>{status}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </div>
  );
}
