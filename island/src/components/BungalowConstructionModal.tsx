import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMemeticsProfile } from "../hooks/useMemeticsProfile";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import WalletSelector, { type WalletSelectorState } from "./WalletSelector";
import {
  getMemeticsErrorMessage,
  MEMETICS_CONTRACT_ADDRESS,
  memeticsAbi,
} from "../utils/memetics";
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
    can_create_petition: boolean;
    profile_ready: boolean;
    qualifies_to_construct_now: boolean;
    qualification_path: string | null;
    active_petition_id: number | null;
    profile_id: number | null;
  } | null;
  token: {
    name: string | null;
    symbol: string | null;
    image_url: string | null;
  };
  contract: {
    contract_address?: string | null;
    bungalow_id: number | null;
    petition_id: number | null;
    primary_asset_key: string;
    primary_asset_chain: number;
    primary_asset_kind: number;
    primary_asset_ref: string;
  };
}

interface CreatePetitionSignatureResponse {
  contract_address?: string;
  wallet?: string;
  profile_id?: number;
  bungalow_name?: string;
  metadata_uri?: string;
  heat_score?: number;
  attested_apes_balance?: string;
  primary_asset_chain?: number;
  primary_asset_kind?: number;
  primary_asset_ref?: string;
  salt?: `0x${string}`;
  deadline?: number;
  sig?: `0x${string}`;
  error?: string;
}

interface SignPetitionSignatureResponse {
  contract_address?: string;
  wallet?: string;
  profile_id?: number;
  petition_id?: number;
  heat_score?: number;
  salt?: `0x${string}`;
  deadline?: number;
  sig?: `0x${string}`;
  error?: string;
}

interface ConfirmResponse {
  created?: boolean;
  petition_id?: number | null;
  supporter_count?: number | null;
  bungalow?: {
    canonical_path?: string | null;
    token_address?: string;
  } | null;
  error?: string;
}

type PendingAction = "create" | "support" | null;

function formatPathLabel(path: string | null | undefined): string {
  if (path === "single_hot_wallet") return "Single high-heat builder";
  if (path === "community_support") return "Community support";
  if (path === "jbac_shortcut") return "10+ Jungle Bay Apes shortcut";
  return "Not qualified yet";
}

function normalizeAddress(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export default function BungalowConstructionModal({
  open,
  onClose,
}: BungalowConstructionModalProps) {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const { publicClient, requireWallet, walletAddress } = usePrivyBaseWallet();
  const { data: memeticsProfile } = useMemeticsProfile(authenticated);

  const [chain, setChain] = useState("base");
  const [ca, setCa] = useState("");
  const [qualification, setQualification] =
    useState<QualificationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [walletSelectorState, setWalletSelectorState] =
    useState<WalletSelectorState>({
      selectedWallet: null,
      selectedWalletAvailable: false,
      hasAvailableWallet: false,
      availableWallets: [],
      totalWallets: 0,
    });
  const onchainWallets = memeticsProfile?.profile?.wallets ?? [];
  const viewerWallet = selectedWallet || walletAddress || "";

  useEffect(() => {
    if (!open) return;

    setChain("base");
    setCa("");
    setQualification(null);
    setIsLoading(false);
    setIsActing(false);
    setPendingTxHash(null);
    setPendingAction(null);
    setResolvedQueryKey(null);
    setStatus(null);
    setError(null);
    setSelectedWallet(walletAddress ?? "");
  }, [open, walletAddress]);

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

  const currentQueryKey = `${chain}:${ca.trim()}:${normalizeAddress(viewerWallet)}`;

  useEffect(() => {
    if (!open || !qualification || !resolvedQueryKey) return;
    if (currentQueryKey === resolvedQueryKey) return;

    setQualification(null);
    setPendingTxHash(null);
    setPendingAction(null);
    setStatus(null);
    setError(null);
  }, [currentQueryKey, open, qualification, resolvedQueryKey]);

  if (!open || typeof document === "undefined") return null;

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
        `/api/memetics/bungalow/${encodeURIComponent(chain)}/${encodeURIComponent(trimmedCa)}${viewerWallet ? `/qualification?viewer_wallet=${encodeURIComponent(viewerWallet)}` : "/qualification"}`,
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
      setResolvedQueryKey(currentQueryKey);
    } catch (loadError) {
      setQualification(null);
      setResolvedQueryKey(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load bungalow qualification",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePetitionAction = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!qualification) return;

    if (!memeticsProfile?.profile) {
      setError("Create your onchain profile before opening or supporting bungalows.");
      return;
    }

    if (
      !pendingTxHash &&
      (!viewerWallet || !walletSelectorState.selectedWalletAvailable)
    ) {
      setError("Choose a connected wallet that is already linked onchain.");
      return;
    }

    setIsActing(true);
    setError(null);
    let submittedTxHash = pendingTxHash;
    let submittedAction = pendingAction;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      let txHash = submittedTxHash;
      let action = submittedAction;
      const contractAddress =
        (typeof qualification.contract.contract_address === "string"
          ? qualification.contract.contract_address
          : MEMETICS_CONTRACT_ADDRESS) as `0x${string}`;

      if (!txHash) {
        if (!publicClient) {
          throw new Error("Missing Base public client");
        }

        const { address, walletClient } = await requireWallet();
        if (
          !onchainWallets.some(
            (wallet) => wallet.toLowerCase() === address.toLowerCase(),
          )
        ) {
          throw new Error("Choose a connected wallet that is already linked onchain.");
        }

        if (qualification.contract.petition_id && qualification.viewer?.can_support) {
          action = "support";
          setStatus("Requesting petition signature...");
          const response = await fetch(
            `/api/memetics/bungalow/${encodeURIComponent(qualification.chain)}/${encodeURIComponent(qualification.token_address)}/petition/sign`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                wallet: address,
              }),
            },
          );
          const data =
            (await response.json().catch(() => null)) as SignPetitionSignatureResponse | null;

          if (
            !response.ok ||
            data?.petition_id === undefined ||
            data.heat_score === undefined ||
            !data.salt ||
            data.deadline === undefined ||
            !data.sig
          ) {
            throw new Error(
              data?.error ?? `Petition signing failed (${response.status})`,
            );
          }

          const args = [
            BigInt(data.petition_id),
            BigInt(data.heat_score),
            data.salt,
            BigInt(data.deadline),
            data.sig,
          ] as const;

          setStatus("Checking petition signature...");
          await publicClient.simulateContract({
            address: contractAddress,
            abi: memeticsAbi,
            functionName: "signBungalowPetition",
            args,
            account: address,
          });

          txHash = await walletClient.writeContract({
            address: contractAddress,
            abi: memeticsAbi,
            functionName: "signBungalowPetition",
            args,
            account: address,
          });
        } else {
          action = "create";
          setStatus("Requesting bungalow petition...");
          const response = await fetch(
            `/api/memetics/bungalow/${encodeURIComponent(qualification.chain)}/${encodeURIComponent(qualification.token_address)}/create/sign`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                wallet: address,
              }),
            },
          );
          const data =
            (await response.json().catch(() => null)) as CreatePetitionSignatureResponse | null;

          if (
            !response.ok ||
            !data?.bungalow_name ||
            data.primary_asset_chain === undefined ||
            data.primary_asset_kind === undefined ||
            !data.primary_asset_ref ||
            data.heat_score === undefined ||
            !data.attested_apes_balance ||
            !data.salt ||
            data.deadline === undefined ||
            !data.sig
          ) {
            throw new Error(
              data?.error ?? `Petition creation failed (${response.status})`,
            );
          }

          const args = [
            data.bungalow_name,
            data.metadata_uri ?? "",
            data.primary_asset_chain,
            data.primary_asset_kind,
            data.primary_asset_ref,
            BigInt(data.heat_score),
            BigInt(data.attested_apes_balance),
            data.salt,
            BigInt(data.deadline),
            data.sig,
          ] as const;

          setStatus("Checking bungalow petition...");
          await publicClient.simulateContract({
            address: contractAddress,
            abi: memeticsAbi,
            functionName: "createBungalowPetition",
            args,
            account: address,
          });

          txHash = await walletClient.writeContract({
            address: contractAddress,
            abi: memeticsAbi,
            functionName: "createBungalowPetition",
            args,
            account: address,
          });
        }

        if (!txHash) {
          throw new Error("Missing Memetics transaction hash");
        }

        setPendingTxHash(txHash);
        setPendingAction(action);
        submittedTxHash = txHash;
        submittedAction = action;
        setStatus("Waiting for Memetics confirmation on Base...");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
        });
        if (receipt.status !== "success") {
          throw new Error("Memetics bungalow transaction failed");
        }
      }

      setStatus(
        action === "support"
          ? "Confirming petition support..."
          : "Confirming bungalow petition...",
      );

      const confirmResponse = await fetch(
        `/api/memetics/bungalow/${encodeURIComponent(qualification.chain)}/${encodeURIComponent(qualification.token_address)}/confirm`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            tx_hash: txHash,
          }),
        },
      );
      const confirmData = (await confirmResponse.json().catch(() => null)) as
        | ConfirmResponse
        | null;

      if (!confirmResponse.ok) {
        throw new Error(
          confirmData?.error ?? `Confirmation failed (${confirmResponse.status})`,
        );
      }

      setPendingTxHash(null);
      setPendingAction(null);

      if (confirmData?.created) {
        const destination =
          confirmData.bungalow?.canonical_path ||
          qualification.canonical_path ||
          `/bungalow/${qualification.token_address}`;
        setStatus("Bungalow opened.");
        navigate(destination);
        onClose();
        return;
      }

      await loadQualification();
      setStatus(
        `Petition updated. ${confirmData?.supporter_count ?? qualification.support.supporter_count} / ${qualification.support.required_supporters} supporters.`,
      );
    } catch (actionError) {
      const message = getMemeticsErrorMessage(
        actionError,
        "Failed to update bungalow petition",
      );
      setStatus(null);
      if (submittedTxHash) {
        setError(
          `${message}. The transaction is already confirmed, so you can retry indexing without signing again.`,
        );
      } else {
        setError(message);
      }
    } finally {
      setIsActing(false);
    }
  };

  const shouldShowSupportAction =
    authenticated &&
    Boolean(memeticsProfile?.profile) &&
    qualification?.viewer?.can_support &&
    !qualification?.support.has_supported &&
    !qualification?.exists;
  const shouldShowCreateAction =
    authenticated &&
    Boolean(memeticsProfile?.profile) &&
    !qualification?.exists &&
    qualification?.viewer?.qualifies_to_construct_now &&
    !qualification?.contract.petition_id;

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>New Bungalow</p>
            <h3>Open a new community bungalow</h3>
            <p className={styles.summary}>
              Bungalows now open through the Memetics contract. You need an
              onchain profile first, then either high enough heat, community
              petition support, or the Jungle Bay Apes shortcut.
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

        <section
          className={`${styles.formRow} ${qualification ? styles.formRowCompact : ""}`}
        >
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
          {!qualification ? (
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
          ) : null}
        </section>

        {authenticated ? (
          <section className={styles.panel} style={{ marginTop: 0 }}>
            <WalletSelector
              label="Sign with"
              panelMode="inline"
              value={selectedWallet}
              eligibleWallets={onchainWallets}
              onSelect={(nextWallet) => {
                setSelectedWallet(nextWallet);
                setError(null);
              }}
              onStateChange={setWalletSelectorState}
            />
            {!memeticsProfile?.profile ? (
              <div className={styles.notice} style={{ margin: "12px 0 0" }}>
                Create your onchain profile in the Profile page before opening
                or supporting bungalow petitions.
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => {
                    navigate("/profile");
                    onClose();
                  }}
                >
                  Open profile
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {qualification ? (
          <section className={styles.panel}>
            <div className={styles.tokenRow}>
              <div>
                <strong>
                  $
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
                <span>Active petition</span>
                <strong>
                  {qualification.contract.petition_id
                    ? `#${qualification.contract.petition_id}`
                    : "None"}
                </strong>
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
                {qualification.thresholds.support_heat_min}+ heat can sign the
                same petition.
              </p>
              <p>
                Shortcut: hold{" "}
                {qualification.thresholds.jbac_shortcut_min_balance}+ Jungle Bay
                Apes.
              </p>
              <p>
                Every write happens through the Memetics contract and requires
                an onchain profile first.
              </p>
            </div>

            {qualification.exists ? (
              <div className={styles.notice}>
                This bungalow is already open onchain.
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
                Connect wallet to open or support this bungalow
              </button>
            ) : null}

            {authenticated &&
            !memeticsProfile?.profile &&
            !qualification.exists ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  navigate("/profile");
                  onClose();
                }}
              >
                Create onchain profile first
              </button>
            ) : null}

            {shouldShowSupportAction ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void handlePetitionAction();
                }}
                disabled={isActing}
              >
                {isActing
                  ? "Signing..."
                  : pendingTxHash && pendingAction === "support"
                    ? "Retry indexing support"
                    : "Sign this petition"}
              </button>
            ) : null}

            {shouldShowCreateAction ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  void handlePetitionAction();
                }}
                disabled={isActing}
              >
                {isActing
                  ? "Processing..."
                  : pendingTxHash
                    ? "Retry indexing petition"
                    : "Create bungalow petition"}
              </button>
            ) : null}

            {authenticated &&
            qualification.contract.petition_id &&
            !qualification.viewer?.can_support &&
            !qualification.support.has_supported &&
            !qualification.exists ? (
              <div className={styles.notice}>
                This bungalow already has an active petition. You need{" "}
                {qualification.thresholds.support_heat_min}+ heat and an onchain
                profile to sign it.
              </div>
            ) : null}

            {authenticated &&
            qualification.support.has_supported &&
            !qualification.exists ? (
              <div className={styles.notice}>
                Your profile already signed this petition. It will open
                automatically once the quorum is reached.
              </div>
            ) : null}
          </section>
        ) : null}

        {status ? <div className={styles.status}>{status}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
