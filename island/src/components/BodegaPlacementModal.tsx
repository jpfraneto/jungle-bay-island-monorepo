import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useMemeticsProfile } from "../hooks/useMemeticsProfile";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import type { DecorationConfig } from "../types/scene";
import { JBM_ADDRESS } from "../utils/constants";
import { formatJbmAmount } from "../utils/formatters";
import {
  formatCreatorLabel,
  getBodegaPreviewUrl,
  type BodegaCatalogItem,
} from "../utils/bodega";
import {
  MEMETICS_CONTRACT_ADDRESS,
  erc20ApprovalAbi,
  getMemeticsErrorMessage,
  memeticsAbi,
  parseJbmToWei,
} from "../utils/memetics";
import WalletSelector, { type WalletSelectorState } from "./WalletSelector";

interface BodegaPlacementModalProps {
  item: BodegaCatalogItem;
  slotId: string;
  bungalowName: string;
  chain: string;
  ca: string;
  onClose: () => void;
  onPlace: (
    slotId: string,
    decoration: Omit<DecorationConfig, "placedAt">,
    authToken: string,
  ) => Promise<unknown>;
  onPlaced: () => void;
}

interface InstallRecord {
  id: number;
}

interface ConfirmedPayment {
  txHash: string;
  payer: string;
  amount: string;
}

interface PlacementRecoveryState {
  payment: ConfirmedPayment | null;
  install: InstallRecord | null;
}

interface QualificationResponse {
  exists?: boolean;
  contract?: {
    bungalow_id?: number | null;
  } | null;
  error?: string;
}

const MAX_UINT256 = (1n << 256n) - 1n;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inferSlotType(slotId: string): string {
  if (slotId === "auto") return "Auto collage";
  if (slotId.includes("wall-frame")) return "Wall frame";
  if (slotId.includes("portal")) return "Portal";
  if (slotId.includes("shelf")) return "Shelf";
  if (slotId.includes("floor")) return "Floor";
  if (slotId.includes("link")) return "Link";
  return "Slot";
}

function isHexAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function inferLinkDecorationType(url: string): DecorationConfig["type"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (
      hostname.includes("x.com") ||
      hostname.includes("twitter.com") ||
      hostname.includes("discord.com") ||
      hostname.includes("telegram.me") ||
      hostname.includes("t.me") ||
      hostname.includes("farcaster")
    ) {
      return "social-link";
    }
  } catch {
    return "website-link";
  }

  return "website-link";
}

function buildPortalLink(item: BodegaCatalogItem): string | undefined {
  const targetChain = asString(item.content.target_chain);
  const targetCa = asString(item.content.target_ca);
  if (!targetChain || !targetCa) {
    return undefined;
  }

  return `/bungalow/${targetCa}?chain=${encodeURIComponent(targetChain)}`;
}

function buildDecorationFromItem(
  item: BodegaCatalogItem,
  placedBy: string,
): Omit<DecorationConfig, "placedAt"> {
  const previewUrl = getBodegaPreviewUrl(item) ?? undefined;
  const burned = Number.parseFloat(item.price_in_jbm);
  const base = {
    name: item.title,
    placedBy,
    jbmBurned: Number.isFinite(burned) ? burned : 0,
  };

  if (item.asset_type === "image") {
    return {
      ...base,
      type: "image",
      imageUrl: asString(item.content.image_url) || previewUrl,
    };
  }

  if (item.asset_type === "link") {
    const linkUrl = asString(item.content.url);
    return {
      ...base,
      type: inferLinkDecorationType(linkUrl),
      linkUrl,
    };
  }

  if (item.asset_type === "game" || item.asset_type === "miniapp") {
    return {
      ...base,
      type: "website-link",
      linkUrl: asString(item.content.url),
    };
  }

  if (item.asset_type === "portal") {
    return {
      ...base,
      type: "portal",
      name: asString(item.content.target_name) || item.title,
      linkUrl: buildPortalLink(item),
    };
  }

  if (item.asset_type === "frame") {
    return {
      ...base,
      type: "decoration",
      name: asString(item.content.text) || item.title,
    };
  }

  if (asString(item.content.format).toLowerCase() === "image") {
    return {
      ...base,
      type: "image",
      imageUrl: asString(item.content.preview_url) || previewUrl,
    };
  }

  return {
    ...base,
    type: "decoration",
    imageUrl: asString(item.content.preview_url) || previewUrl,
    linkUrl: asString(item.content.external_url) || undefined,
  };
}

function normalizeInstallRecord(input: unknown): InstallRecord | null {
  const candidate =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : null;
  const id = Number(candidate?.id ?? 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return { id };
}

function getPlacementRecoveryKey(input: {
  chain: string;
  ca: string;
  itemId: number;
  slotId: string;
}): string {
  return `jbi:bodega-placement:${input.chain}:${input.ca}:${input.itemId}:${input.slotId}`;
}

function readPlacementRecoveryState(
  key: string,
): PlacementRecoveryState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      payment?: unknown;
      install?: unknown;
    };

    const payment =
      parsed.payment && typeof parsed.payment === "object"
        ? (parsed.payment as ConfirmedPayment)
        : null;
    const install = normalizeInstallRecord(parsed.install);

    const normalizedPayment =
      payment &&
      typeof payment.txHash === "string" &&
      typeof payment.payer === "string" &&
      typeof payment.amount === "string"
        ? payment
        : null;
    const normalizedInstall = normalizedPayment ? install : null;

    if (!normalizedPayment && !normalizedInstall) {
      return null;
    }

    return {
      payment: normalizedPayment,
      install: normalizedInstall,
    };
  } catch {
    return null;
  }
}

function writePlacementRecoveryState(
  key: string,
  state: PlacementRecoveryState,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(key, JSON.stringify(state));
}

function clearPlacementRecoveryState(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(key);
}

export default function BodegaPlacementModal({
  item,
  slotId,
  bungalowName,
  chain,
  ca,
  onClose,
  onPlace,
  onPlaced,
}: BodegaPlacementModalProps) {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { publicClient, requireWallet, walletAddress } = usePrivyBaseWallet();
  const { data: memeticsProfile } = useMemeticsProfile(authenticated);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<string>("");
  const [walletSelectorState, setWalletSelectorState] =
    useState<WalletSelectorState>({
      selectedWallet: null,
      selectedWalletAvailable: false,
      hasAvailableWallet: false,
      availableWallets: [],
      totalWallets: 0,
    });
  const [confirmedPayment, setConfirmedPayment] =
    useState<ConfirmedPayment | null>(null);
  const [confirmedInstall, setConfirmedInstall] =
    useState<InstallRecord | null>(null);
  const onchainWallets = memeticsProfile?.profile?.wallets ?? [];
  const recoveryKey = getPlacementRecoveryKey({
    chain,
    ca,
    itemId: item.id,
    slotId,
  });

  useEffect(() => {
    const recovered = readPlacementRecoveryState(recoveryKey);

    setStatus(null);
    setError(null);
    setSelectedWallet(recovered?.payment?.payer ?? walletAddress ?? "");
    setConfirmedPayment(recovered?.payment ?? null);
    setConfirmedInstall(recovered?.install ?? null);
  }, [item.id, recoveryKey, slotId, walletAddress]);

  useEffect(() => {
    if (!confirmedPayment && !confirmedInstall) {
      clearPlacementRecoveryState(recoveryKey);
      return;
    }

    writePlacementRecoveryState(recoveryKey, {
      payment: confirmedPayment,
      install: confirmedInstall,
    });
  }, [confirmedInstall, confirmedPayment, recoveryKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  const previewUrl = getBodegaPreviewUrl(item);
  const creatorLabel = formatCreatorLabel(item);
  const canRetryWithoutPaying = Boolean(confirmedPayment);
  const canRetryPlacementOnly = Boolean(confirmedInstall);
  const isProcessing = Boolean(status);
  const lockedPayer = confirmedPayment?.payer ?? null;

  const handlePlace = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!memeticsProfile?.profile) {
      setError("Create your onchain profile before installing Bodega items.");
      return;
    }

    if (!item.contract_artifact_id) {
      setError("This listing is not linked to an onchain artifact yet.");
      return;
    }

    const payoutWallet = selectedWallet || walletAddress;
    if (
      !confirmedPayment &&
      (!payoutWallet || !walletSelectorState.selectedWalletAvailable)
    ) {
      setError("Choose a connected wallet that is already linked onchain.");
      return;
    }

    setStatus(null);
    setError(null);

    let payment = confirmedPayment;
    let install = confirmedInstall;

    try {
      if (!payment) {
        if (!publicClient) {
          throw new Error("Missing Base public client");
        }

        const token = await getAccessToken();
        if (!token) {
          throw new Error("Missing auth token");
        }

        const bungalowResponse = await fetch(
          `/api/memetics/bungalow/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/qualification?viewer_wallet=${encodeURIComponent(payoutWallet ?? "")}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );
        const bungalowData =
          (await bungalowResponse.json().catch(() => null)) as QualificationResponse | null;
        if (!bungalowResponse.ok) {
          throw new Error(
            bungalowData?.error ??
              `Could not resolve onchain bungalow (${bungalowResponse.status})`,
          );
        }

        const bungalowId = Number(bungalowData?.contract?.bungalow_id ?? 0);
        if (!bungalowData?.exists || bungalowId <= 0) {
          throw new Error("This bungalow is not active onchain yet.");
        }

        if (!isHexAddress(JBM_ADDRESS)) {
          throw new Error("JBM token address is not configured.");
        }
        if (!isHexAddress(MEMETICS_CONTRACT_ADDRESS)) {
          throw new Error("Memetics contract address is not configured.");
        }

        const { address, walletClient } = await requireWallet();
        if (
          !onchainWallets.some(
            (wallet) => wallet.toLowerCase() === address.toLowerCase(),
          )
        ) {
          throw new Error("Choose a connected wallet that is already linked onchain.");
        }

        const priceWei = parseJbmToWei(item.price_in_jbm);
        const allowance = await publicClient.readContract({
          address: JBM_ADDRESS,
          abi: erc20ApprovalAbi,
          functionName: "allowance",
          args: [address, MEMETICS_CONTRACT_ADDRESS],
        });

        if (allowance < priceWei) {
          setStatus("Approving JBM for the Memetics contract...");
          const approveHash = await walletClient.writeContract({
            address: JBM_ADDRESS,
            abi: erc20ApprovalAbi,
            functionName: "approve",
            args: [MEMETICS_CONTRACT_ADDRESS, MAX_UINT256],
            account: address,
          });
          const approveReceipt = await publicClient.waitForTransactionReceipt({
            hash: approveHash,
          });
          if (approveReceipt.status !== "success") {
            throw new Error("JBM approval failed");
          }
        }

        setStatus("Checking onchain Bodega install...");
        await publicClient.simulateContract({
          address: MEMETICS_CONTRACT_ADDRESS,
          abi: memeticsAbi,
          functionName: "installArtifact",
          args: [BigInt(item.contract_artifact_id), BigInt(bungalowId)],
          account: address,
        });

        const hash = await walletClient.writeContract({
          address: MEMETICS_CONTRACT_ADDRESS,
          abi: memeticsAbi,
          functionName: "installArtifact",
          args: [BigInt(item.contract_artifact_id), BigInt(bungalowId)],
          account: address,
        });

        payment = {
          txHash: hash,
          payer: address,
          amount: item.price_in_jbm,
        };
        setSelectedWallet(address);
        setConfirmedPayment(payment);

        setStatus("Waiting for install confirmation on Base...");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Bodega install transaction failed");
        }
      }

      if (!install) {
        setStatus("Recording Bodega install...");
        const token = await getAccessToken();
        if (!token) {
          throw new Error("Missing auth token");
        }

        const response = await fetch("/api/bodega/install", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            catalog_item_id: item.id,
            installed_by_wallet: payment.payer,
            installed_to_token_address: ca,
            installed_to_chain: chain,
            tx_hash: payment.txHash,
          }),
        });

        const data = (await response.json().catch(() => null)) as {
          install?: unknown;
          error?: unknown;
        } | null;
        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;
        install = normalizeInstallRecord(data?.install);

        if (!response.ok || !install) {
          throw new Error(apiError ?? `Request failed (${response.status})`);
        }

        setConfirmedInstall(install);
      }

      setStatus("Placing item in the bungalow...");
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Missing auth token");
      }

      await onPlace(
        slotId,
        buildDecorationFromItem(item, payment.payer),
        token,
      );

      clearPlacementRecoveryState(recoveryKey);
      setConfirmedPayment(null);
      setConfirmedInstall(null);
      setStatus(null);
      onPlaced();
    } catch (placementError) {
      const message = getMemeticsErrorMessage(
        placementError,
        "Failed to place Bodega item",
      );

      if (install || canRetryPlacementOnly) {
        setError(
          `${message}. The payment and install are already confirmed, so you can retry placement without paying again.`,
        );
      } else if (payment || canRetryWithoutPaying) {
        setError(
          `${message}. The payment is already confirmed, so you can continue the install without paying again.`,
        );
      } else {
        setError(message);
      }
      setStatus(null);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 1200,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Place ${item.title}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(480px, 92vw)",
          background: "#102010",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 22,
          color: "#f7efd6",
          display: "grid",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 22 }}>Place from the Bodega</h3>
            <p
              style={{
                margin: "6px 0 0",
                color: "rgba(247,239,214,0.66)",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {inferSlotType(slotId)} · {bungalowName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              borderRadius: 8,
              width: 36,
              height: 36,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            background: "rgba(255,255,255,0.04)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={item.title}
              style={{
                width: 68,
                height: 68,
                borderRadius: 10,
                objectFit: "cover",
                display: "block",
                flex: "0 0 auto",
              }}
            />
          ) : (
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: 10,
                background: "#1a3a1a",
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
              }}
            >
              🛖
            </div>
          )}
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>{item.title}</strong>
            <span style={{ fontSize: 12, color: "rgba(247,239,214,0.7)" }}>
              by {creatorLabel}
            </span>
            <span style={{ fontSize: 12, color: "#ffe8a0" }}>
              {formatJbmAmount(item.price_in_jbm)}
            </span>
          </div>
        </div>

        {lockedPayer ? (
          <div
            style={{
              display: "grid",
              gap: 6,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(0,0,0,0.18)",
              padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: 13, color: "rgba(247,239,214,0.72)" }}>
              Pay with
            </span>
            <strong style={{ fontSize: 14, color: "#f7efd6" }}>
              {lockedPayer}
            </strong>
            <span style={{ fontSize: 12, color: "rgba(247,239,214,0.72)" }}>
              {canRetryPlacementOnly
                ? "Install is already recorded. You can retry the bungalow placement without paying again."
                : "Payment is already confirmed. Continuing will finish the install without another transfer."}
            </span>
          </div>
        ) : (
          <WalletSelector
            label="Sign with"
            value={selectedWallet}
            eligibleWallets={onchainWallets}
            onSelect={(nextAddress) => {
              setSelectedWallet(nextAddress);
              setError(null);
            }}
            onStateChange={setWalletSelectorState}
          />
        )}

        {status ? (
          <div style={{ color: "#9dd7a8", fontSize: 12 }}>{status}</div>
        ) : null}
        {error ? (
          <div style={{ color: "#ffd3d3", fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 40,
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handlePlace();
            }}
            disabled={isProcessing}
            style={{
              minHeight: 40,
              padding: "0 16px",
              borderRadius: 10,
              border: 0,
              background: "#2f6a2f",
              color: "white",
              cursor: isProcessing ? "progress" : "pointer",
              font: "inherit",
              fontWeight: 700,
            }}
          >
            {isProcessing
              ? "Processing..."
              : canRetryPlacementOnly
                ? "Retry placement"
                : canRetryWithoutPaying
                  ? "Continue install"
                  : `Pay ${formatJbmAmount(item.price_in_jbm)}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
