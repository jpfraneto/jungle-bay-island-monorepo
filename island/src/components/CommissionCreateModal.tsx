import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useMemeticsProfile } from "../hooks/useMemeticsProfile";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { JBM_ADDRESS } from "../utils/constants";
import { formatJbmAmount } from "../utils/formatters";
import {
  COMMISSION_MANAGER_CONTRACT_ADDRESS,
  commissionManagerAbi,
  erc20ApprovalAbi,
  getMemeticsErrorMessage,
} from "../utils/memetics";
import {
  normalizeCommissionDetailResponse,
  normalizeCommissionDraftResponse,
} from "../utils/commissions";
import type { DirectoryBungalow } from "../utils/bodega";
import styles from "../styles/commission-create-modal.module.css";
import BungalowOptionPicker from "./BungalowOptionPicker";
import WalletSelector, { type WalletSelectorState } from "./WalletSelector";

interface CommissionCreateModalProps {
  open: boolean;
  bungalowOptions: DirectoryBungalow[];
  isDirectoryLoading?: boolean;
  onClose: () => void;
  onCreated?: (commissionId: number) => void;
}

function isHexAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function getBungalowKey(bungalow: DirectoryBungalow): string {
  return `${bungalow.chain}:${bungalow.token_address}`;
}

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function buildDefaultDeadlineValue(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toLocalDateTimeInputValue(date);
}

function deriveClaimDeadlinePreview(value: string): string {
  const delivery = new Date(value);
  if (Number.isNaN(delivery.getTime())) {
    return "An acceptance window will open automatically when you select an artist.";
  }

  const deliveryUnix = Math.floor(delivery.getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);
  const claimUnix = Math.min(
    deliveryUnix - 24 * 60 * 60,
    nowUnix + 7 * 24 * 60 * 60,
  );
  if (claimUnix <= nowUnix) {
    return "Pick a delivery deadline at least 48 hours away so the selected artist has time to accept.";
  }

  return `Once you select an artist, they will have until ${new Date(claimUnix * 1000).toLocaleString()} to accept the job.`;
}

export default function CommissionCreateModal({
  open,
  bungalowOptions,
  isDirectoryLoading = false,
  onClose,
  onCreated,
}: CommissionCreateModalProps) {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const {
    activeWallet,
    publicClient,
    requireWallet,
    setActiveWallet,
    walletAddress,
  } = usePrivyBaseWallet();
  const { data: memeticsProfile, isLoading: isProfileLoading } =
    useMemeticsProfile(authenticated);

  const [selectedBungalowKey, setSelectedBungalowKey] = useState("");
  const [selectedWallet, setSelectedWallet] = useState("");
  const [walletState, setWalletState] = useState<WalletSelectorState>({
    selectedWallet: null,
    selectedWalletAvailable: false,
    hasAvailableWallet: false,
    availableWallets: [],
    totalWallets: 0,
  });
  const [deadlineValue, setDeadlineValue] = useState(buildDefaultDeadlineValue);
  const [rateLabel, setRateLabel] = useState("");
  const [budgetJbm, setBudgetJbm] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onchainWallets = memeticsProfile?.profile?.wallets ?? [];
  const selectedBungalow = useMemo(
    () =>
      bungalowOptions.find(
        (bungalow) => getBungalowKey(bungalow) === selectedBungalowKey,
      ) ?? null,
    [bungalowOptions, selectedBungalowKey],
  );

  useEffect(() => {
    if (!open) return;

    setSelectedBungalowKey((current) => {
      if (current) return current;
      return bungalowOptions[0] ? getBungalowKey(bungalowOptions[0]) : "";
    });
    setSelectedWallet((current) => current || walletAddress || "");
    setDeadlineValue(buildDefaultDeadlineValue());
    setRateLabel("");
    setBudgetJbm("");
    setPrompt("");
    setStatus(null);
    setError(null);
  }, [bungalowOptions, open, walletAddress]);

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

  const profileMissing = authenticated && !isProfileLoading && !memeticsProfile?.profile;
  const deadlinePreview = deriveClaimDeadlinePreview(deadlineValue);

  const handleSubmit = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (profileMissing) {
      setError("Create your onchain profile on the profile page before opening commissions.");
      return;
    }

    if (!selectedBungalow) {
      setError("Choose the bungalow commissioning this artwork.");
      return;
    }

    if (!rateLabel.trim()) {
      setError("Add a rate or format label for the commission.");
      return;
    }

    if (!budgetJbm.trim()) {
      setError("Set the budget in jungle bay memes.");
      return;
    }

    if (!prompt.trim()) {
      setError("Add the creative prompt.");
      return;
    }

    if (!walletState.hasAvailableWallet || !selectedWallet) {
      setError("Choose a connected wallet that is already linked to your onchain profile.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setStatus("Preparing commission draft...");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const draftResponse = await fetch("/api/commissions/drafts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: selectedWallet,
          bungalow_chain: selectedBungalow.chain,
          bungalow_token_address: selectedBungalow.token_address,
          rate_label: rateLabel.trim(),
          budget_jbm: budgetJbm.trim(),
          prompt: prompt.trim(),
          delivery_deadline: new Date(deadlineValue).toISOString(),
        }),
      });
      const draftPayload = await draftResponse.json().catch(() => null);
      if (!draftResponse.ok) {
        const message =
          typeof draftPayload?.error === "string"
            ? draftPayload.error
            : `Request failed (${draftResponse.status})`;
        throw new Error(message);
      }

      const draft = normalizeCommissionDraftResponse(draftPayload);
      if (!draft) {
        throw new Error("Commission draft payload was incomplete.");
      }

      if (!isHexAddress(JBM_ADDRESS)) {
        throw new Error("VITE_JBM_ADDRESS is not configured for Base.");
      }

      const commissionManagerAddress = isHexAddress(
        draft.commission_manager_address ?? draft.contract_address,
      )
        ? (draft.commission_manager_address ?? draft.contract_address)
        : COMMISSION_MANAGER_CONTRACT_ADDRESS;
      if (!isHexAddress(commissionManagerAddress)) {
        throw new Error("VITE_COMMISSION_MANAGER_CONTRACT_ADDRESS is not configured.");
      }

      if (!draft.bungalow.contract_bungalow_id) {
        throw new Error("This bungalow does not have an onchain id yet.");
      }

      if (selectedWallet && selectedWallet.toLowerCase() !== activeWallet?.address.toLowerCase()) {
        setActiveWallet(selectedWallet);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }

      const { address, walletClient } = await requireWallet();
      if (address.toLowerCase() !== draft.requester_wallet.toLowerCase()) {
        throw new Error("Switch to the selected onchain-linked wallet and try again.");
      }

      const requiredBudgetWei = BigInt(draft.budget_wei);
      const allowance = await publicClient.readContract({
        address: JBM_ADDRESS,
        abi: erc20ApprovalAbi,
        functionName: "allowance",
        args: [address, commissionManagerAddress],
      });

      if (allowance < requiredBudgetWei) {
        setStatus(`Approving ${formatJbmAmount(draft.budget_jbm)} for escrow...`);
        const approvalHash = await walletClient.writeContract({
          address: JBM_ADDRESS,
          abi: erc20ApprovalAbi,
          functionName: "approve",
          args: [commissionManagerAddress, requiredBudgetWei],
          account: address,
          chain: undefined,
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        });
        if (approvalReceipt.status !== "success") {
          throw new Error("JBM approval failed onchain.");
        }
      }

      setStatus("Creating the onchain commission escrow...");
      const hash = await walletClient.writeContract({
        address: commissionManagerAddress,
        abi: commissionManagerAbi,
        functionName: "createCommission",
        args: [
          BigInt(draft.bungalow.contract_bungalow_id),
          BigInt(draft.delivery_deadline),
          requiredBudgetWei,
          draft.brief_uri,
        ],
        account: address,
        chain: undefined,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Commission creation failed onchain.");
      }

      setStatus("Indexing the live commission...");
      const confirmResponse = await fetch("/api/commissions/confirm-create", {
        method: "POST",
        headers,
        body: JSON.stringify({
          brief_id: draft.brief_id,
          tx_hash: receipt.transactionHash,
        }),
      });
      const confirmPayload = await confirmResponse.json().catch(() => null);
      if (!confirmResponse.ok) {
        const message =
          typeof confirmPayload?.error === "string"
            ? confirmPayload.error
            : `Request failed (${confirmResponse.status})`;
        throw new Error(message);
      }

      const detail = normalizeCommissionDetailResponse(confirmPayload);
      const commissionId = detail.commission?.commission_id ?? null;
      setStatus("Commission opened.");

      if (commissionId && onCreated) {
        onCreated(commissionId);
      }
      onClose();
      if (commissionId) {
        navigate(`/commissions/${commissionId}`);
      }
    } catch (submitError) {
      setError(
        getMemeticsErrorMessage(
          submitError,
          "Failed to create the commission. Please try again.",
        ),
      );
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>New Commission</p>
            <h3>Escrow a new creative brief</h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {profileMissing ? (
          <section className={styles.warningCard}>
            <strong>Your onchain profile is not ready yet.</strong>
            <span>
              Open your profile, register your onchain handle, and link the wallet
              you want to spend from before creating commissions.
            </span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                onClose();
                navigate("/profile");
              }}
            >
              Open profile
            </button>
          </section>
        ) : null}

        <section className={styles.formSection}>
          <label className={styles.fieldLabel}>Commissioning bungalow</label>
          {isDirectoryLoading && bungalowOptions.length === 0 ? (
            <div className={styles.inlineStatus}>Loading bungalows...</div>
          ) : bungalowOptions.length === 0 ? (
            <div className={styles.warningCard}>
              <strong>No open bungalows are available right now.</strong>
              <span>
                Open or sync a bungalow first, then come back and commission work
                for it.
              </span>
            </div>
          ) : (
            <BungalowOptionPicker
              options={bungalowOptions}
              selectedKey={selectedBungalowKey}
              onSelect={(value) => {
                setSelectedBungalowKey(value);
                setError(null);
              }}
            />
          )}
          <p className={styles.note}>
            This anchors the brief to the community the piece is meant for.
          </p>
        </section>

        <section className={styles.formSection}>
          <WalletSelector
            value={selectedWallet}
            onSelect={(wallet) => {
              setSelectedWallet(wallet);
              setError(null);
            }}
            label="Spend from"
            panelMode="inline"
            eligibleWallets={onchainWallets}
            onStateChange={setWalletState}
          />
          <p className={styles.note}>
            The selected wallet must already be linked to your Memetics profile,
            because it will fund the onchain escrow.
          </p>
        </section>

        <section className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Rate / format</span>
            <input
              className={styles.input}
              value={rateLabel}
              onChange={(event) => setRateLabel(event.target.value)}
              placeholder="Cover art, loop animation, poster set..."
              maxLength={80}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Budget (JBM)</span>
            <input
              className={styles.input}
              value={budgetJbm}
              onChange={(event) => setBudgetJbm(event.target.value)}
              placeholder="69000"
              inputMode="decimal"
            />
          </label>
        </section>

        <section className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery deadline</span>
            <input
              className={styles.input}
              type="datetime-local"
              value={deadlineValue}
              onChange={(event) => setDeadlineValue(event.target.value)}
            />
          </label>
          <div className={styles.previewCard}>
            <strong>Acceptance window</strong>
            <span>{deadlinePreview}</span>
          </div>
        </section>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prompt</span>
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the art direction, references, emotional tone, format, and what the bungalow community should feel."
            maxLength={4000}
            rows={7}
          />
        </label>

        <footer className={styles.footer}>
          <div className={styles.footerMeta}>
            <strong>Escrow model</strong>
            <span>
              The full {budgetJbm.trim() ? formatJbmAmount(budgetJbm) : "budget"}{" "}
              is locked onchain immediately. Artists get paid from that escrow
              when the work is approved.
            </span>
            {status ? <span className={styles.status}>{status}</span> : null}
            {error ? <span className={styles.error}>{error}</span> : null}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting || bungalowOptions.length === 0}
            >
              {isSubmitting ? "Creating..." : "Open commission"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
