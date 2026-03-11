import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import BodegaCard from "./BodegaCard";
import BungalowOptionPicker from "./BungalowOptionPicker";
import WalletSelector, { type WalletSelectorState } from "./WalletSelector";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { formatJbmAmount } from "../utils/formatters";
import styles from "../styles/bodega-submit-modal.module.css";
import {
  getBodegaAssetIcon,
  getBodegaListingPath,
  normalizeBodegaCatalogItem,
  type BodegaAssetType,
  type BodegaCatalogItem,
  type DirectoryBungalow,
} from "../utils/bodega";

interface BodegaSubmitModalProps {
  open: boolean;
  bungalowOptions: DirectoryBungalow[];
  isDirectoryLoading?: boolean;
  isWalletScoped?: boolean;
  selectionNote?: string | null;
  defaultOriginBungalow?: DirectoryBungalow | null;
  onClose: () => void;
  onSubmitted?: (item: BodegaCatalogItem) => void;
}

type BodegaListingType = "art" | "miniapp";
type ArtFormat = "image" | "glb";
type ModalStep = 1 | 2 | 3;
const BODEGA_SUBMISSION_FEE = 69_000;
const PENDING_SUBMISSION_PAYMENT_STORAGE_KEY =
  "jbi:bodega:pending-submission-payment";

interface PendingSubmissionPayment {
  draftFingerprint: string;
  txHash: string;
  payer: string;
}

type DraftFieldKey = "title" | "price" | "previewUrl" | "url";

type DraftFieldErrors = Partial<Record<DraftFieldKey, string>>;

interface BuildMetadata {
  title: string;
  description: string;
  image: string;
  missingFields: Array<"title" | "description" | "image">;
}

interface PublishEligibility {
  wallet: string;
  linked_wallets: string[];
  island_heat: number;
  minimum_heat: number;
  can_publish: boolean;
}

/**
 * Restores a pending publishing-fee payment so retries can survive refreshes.
 */
function readPendingSubmissionPayment(): PendingSubmissionPayment | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      PENDING_SUBMISSION_PAYMENT_STORAGE_KEY,
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingSubmissionPayment> | null;
    if (
      !parsed ||
      typeof parsed.draftFingerprint !== "string" ||
      typeof parsed.txHash !== "string" ||
      typeof parsed.payer !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(parsed.txHash)
    ) {
      window.localStorage.removeItem(PENDING_SUBMISSION_PAYMENT_STORAGE_KEY);
      return null;
    }

    return {
      draftFingerprint: parsed.draftFingerprint,
      txHash: parsed.txHash,
      payer: parsed.payer,
    };
  } catch {
    window.localStorage.removeItem(PENDING_SUBMISSION_PAYMENT_STORAGE_KEY);
    return null;
  }
}

/**
 * Persists or clears the pending publishing-fee payment between page loads.
 */
function writePendingSubmissionPayment(
  payment: PendingSubmissionPayment | null,
): void {
  if (typeof window === "undefined") return;

  if (!payment) {
    window.localStorage.removeItem(PENDING_SUBMISSION_PAYMENT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    PENDING_SUBMISSION_PAYMENT_STORAGE_KEY,
    JSON.stringify(payment),
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyGlbUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.pathname.toLowerCase().endsWith(".glb");
  } catch {
    return false;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getBuildFallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || "Untitled Build";
  } catch {
    return "Untitled Build";
  }
}

function getBungalowKey(bungalow: DirectoryBungalow): string {
  return `${bungalow.chain}:${bungalow.token_address}`;
}

function asPositiveNumber(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function getFirstInvalidField(errors: DraftFieldErrors): DraftFieldKey | null {
  const orderedFields: DraftFieldKey[] = [
    "title",
    "previewUrl",
    "url",
    "price",
  ];

  return orderedFields.find((field) => Boolean(errors[field])) ?? null;
}

/**
 * Builds the type-specific content payload expected by the Bodega submit API.
 */
function buildContentPayload(input: {
  assetType: BodegaAssetType;
  artFormat: ArtFormat;
  title: string;
  description: string;
  previewUrl: string;
  url: string;
}): Record<string, string> {
  if (input.assetType === "decoration") {
    return {
      preview_url: input.previewUrl,
      external_url: input.artFormat === "glb" ? input.url : input.previewUrl,
      format: input.artFormat,
    };
  }

  return {
    url: input.url,
    name: input.title,
    description: input.description,
  };
}

/**
 * Validates the current draft before the preview or submit step.
 */
function validateDraft(input: {
  assetType: BodegaAssetType;
  artFormat: ArtFormat;
  title: string;
  price: string;
  previewUrl: string;
  url: string;
}): {
  fieldErrors: DraftFieldErrors;
  firstInvalidField: DraftFieldKey | null;
} {
  const fieldErrors: DraftFieldErrors = {};

  if (input.assetType !== "miniapp" && !input.title.trim()) {
    fieldErrors.title = "Give this listing a title.";
  }

  if (asPositiveNumber(input.price) === null) {
    fieldErrors.price = "Set a positive JBM install price.";
  }

  if (input.assetType === "decoration") {
    if (!isHttpUrl(input.previewUrl)) {
      fieldErrors.previewUrl =
        input.artFormat === "glb"
          ? "Add a valid preview image URL for this GLB."
          : "Art image must be a valid http(s) URL.";
    }

    if (input.artFormat === "glb" && !isHttpUrl(input.url)) {
      fieldErrors.url = "GLB assets need a valid file URL.";
    } else if (input.artFormat === "glb" && !isLikelyGlbUrl(input.url)) {
      fieldErrors.url = "GLB file URL should end in .glb.";
    }
  }

  if (input.assetType === "miniapp") {
    if (!isHttpUrl(input.url)) {
      fieldErrors.url = "Builds need a valid http(s) URL.";
    }
  }

  return {
    fieldErrors,
    firstInvalidField: getFirstInvalidField(fieldErrors),
  };
}

export default function BodegaSubmitModal({
  open,
  bungalowOptions,
  isDirectoryLoading = false,
  isWalletScoped = false,
  selectionNote = null,
  defaultOriginBungalow = null,
  onClose,
  onSubmitted,
}: BodegaSubmitModalProps) {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { transfer, isTransferring } = useJBMTransfer();

  const [step, setStep] = useState<ModalStep>(1);
  const [listingType, setListingType] = useState<BodegaListingType>("art");
  const [artFormat, setArtFormat] = useState<ArtFormat>("image");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("50000");
  const [previewUrl, setPreviewUrl] = useState("");
  const [url, setUrl] = useState("");
  const [buildMetadata, setBuildMetadata] = useState<BuildMetadata | null>(null);
  const [isBuildMetadataLoading, setIsBuildMetadataLoading] = useState(false);
  const [buildMetadataError, setBuildMetadataError] = useState<string | null>(
    null,
  );
  const [originKey, setOriginKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DraftFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPayment, setPendingPayment] =
    useState<PendingSubmissionPayment | null>(() =>
      readPendingSubmissionPayment(),
    );
  const [pendingFocusField, setPendingFocusField] =
    useState<DraftFieldKey | null>(null);
  const [submittedItem, setSubmittedItem] = useState<BodegaCatalogItem | null>(
    null,
  );
  const [selectedPayWallet, setSelectedPayWallet] = useState<string>("");
  const [walletSelectorState, setWalletSelectorState] =
    useState<WalletSelectorState>({
      selectedWallet: null,
      selectedWalletAvailable: false,
      hasAvailableWallet: false,
      availableWallets: [],
      totalWallets: 0,
    });
  const [publishEligibility, setPublishEligibility] =
    useState<PublishEligibility | null>(null);
  const [isEligibilityLoading, setIsEligibilityLoading] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const creatorWallet = selectedPayWallet || walletAddress || "";

  useEffect(() => {
    if (!open) return;

    setStep(1);
    setListingType("art");
    setArtFormat("image");
    setTitle("");
    setDescription("");
    setPrice("50000");
    setPreviewUrl("");
    setUrl("");
    setBuildMetadata(null);
    setIsBuildMetadataLoading(false);
    setBuildMetadataError(null);
    const preferredKey = defaultOriginBungalow
      ? getBungalowKey(defaultOriginBungalow)
      : "";
    const hasPreferred = bungalowOptions.some(
      (bungalow) => getBungalowKey(bungalow) === preferredKey,
    );
    setOriginKey(
      hasPreferred ? preferredKey : !isWalletScoped ? preferredKey : "",
    );
    setStatus(null);
    setError(null);
    setFieldErrors({});
    setIsSubmitting(false);
    setPendingFocusField(null);
    setSubmittedItem(null);
    setShareStatus(null);
  }, [bungalowOptions, defaultOriginBungalow, isWalletScoped, open]);

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

  useEffect(() => {
    writePendingSubmissionPayment(pendingPayment);
  }, [pendingPayment]);

  useEffect(() => {
    if (!open || !creatorWallet) {
      setPublishEligibility(null);
      setEligibilityError(null);
      setIsEligibilityLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsEligibilityLoading(true);
    setEligibilityError(null);

    async function loadEligibility() {
      try {
        const response = await fetch(
          `/api/bodega/publish-eligibility/${encodeURIComponent(creatorWallet)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const data = (await response.json().catch(() => null)) as
          | Partial<PublishEligibility> & { error?: unknown }
          | null;
        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;

        if (!response.ok) {
          throw new Error(
            apiError ?? `Could not verify island heat (${response.status})`,
          );
        }

        if (controller.signal.aborted) {
          return;
        }

        setPublishEligibility({
          wallet:
            typeof data?.wallet === "string" && data.wallet.trim()
              ? data.wallet
              : creatorWallet,
          linked_wallets: Array.isArray(data?.linked_wallets)
            ? data.linked_wallets.filter(
                (entry): entry is string =>
                  typeof entry === "string" && entry.trim().length > 0,
              )
            : [creatorWallet],
          island_heat: Number(data?.island_heat ?? 0),
          minimum_heat: Number(data?.minimum_heat ?? 25),
          can_publish: Boolean(data?.can_publish),
        });
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setPublishEligibility(null);
        setEligibilityError(
          loadError instanceof Error
            ? loadError.message
            : "Could not verify island heat right now.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsEligibilityLoading(false);
        }
      }
    }

    void loadEligibility();

    return () => controller.abort();
  }, [creatorWallet, open]);

  useEffect(() => {
    if (!open || listingType !== "miniapp") {
      setBuildMetadata(null);
      setIsBuildMetadataLoading(false);
      setBuildMetadataError(null);
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setBuildMetadata(null);
      setIsBuildMetadataLoading(false);
      setBuildMetadataError(null);
      return;
    }

    if (!isHttpUrl(trimmedUrl)) {
      setBuildMetadata(null);
      setIsBuildMetadataLoading(false);
      setBuildMetadataError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setIsBuildMetadataLoading(true);
      setBuildMetadataError(null);

      void (async () => {
        try {
          const response = await fetch(`/api/og?url=${encodeURIComponent(trimmedUrl)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const data = (await response.json().catch(() => null)) as
            | { title?: unknown; description?: unknown; image?: unknown }
            | null;

          if (controller.signal.aborted) return;

          const remoteTitle = asString(data?.title);
          const remoteDescription = asString(data?.description);
          const remoteImage = asString(data?.image);

          setBuildMetadata({
            title: remoteTitle || getBuildFallbackTitle(trimmedUrl),
            description: remoteDescription,
            image: remoteImage,
            missingFields: [
              ...(remoteTitle ? [] : (["title"] as const)),
              ...(remoteDescription ? [] : (["description"] as const)),
              ...(remoteImage ? [] : (["image"] as const)),
            ],
          });
        } catch {
          if (controller.signal.aborted) return;
          setBuildMetadata({
            title: getBuildFallbackTitle(trimmedUrl),
            description: "",
            image: "",
            missingFields: ["title", "description", "image"],
          });
          setBuildMetadataError(
            "Could not read metadata from that link. You can still submit it, but it will preview better once the site exposes title, description, and image tags.",
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsBuildMetadataLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [listingType, open, url]);

  const clearFieldError = (field: DraftFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const getFieldTarget = (field: DraftFieldKey): HTMLInputElement | null => {
    if (field === "title") return titleInputRef.current;
    if (field === "price") return priceInputRef.current;
    if (field === "previewUrl") return previewUrlInputRef.current;
    if (field === "url") return urlInputRef.current;
    return null;
  };

  useEffect(() => {
    if (step !== 2 || !pendingFocusField) return;

    const target = getFieldTarget(pendingFocusField);
    if (!target) {
      setPendingFocusField(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      target.focus();
      setPendingFocusField(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pendingFocusField, step]);

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedPayWallet) return;
    setSelectedPayWallet(walletAddress);
  }, [selectedPayWallet, walletAddress]);

  const assetType: BodegaAssetType =
    listingType === "art" ? "decoration" : "miniapp";
  const isBuildListing = assetType === "miniapp";
  const listingTitle = listingType === "art" ? "Art" : "Build";
  const resolvedTitle = isBuildListing
    ? buildMetadata?.title || getBuildFallbackTitle(url.trim())
    : title.trim();
  const resolvedDescription = isBuildListing
    ? buildMetadata?.description || ""
    : description.trim();
  const resolvedPreviewUrl = isBuildListing
    ? buildMetadata?.image || ""
    : previewUrl.trim();
  const buildMissingMetadataDetails =
    buildMetadata?.missingFields
      .map((field) => {
        if (field === "title") return "title (`og:title` or `<title>`)";
        if (field === "description")
          return "description (`og:description` or `meta description`)";
        return "image (`og:image` or `twitter:image`)";
      })
      .join(", ") ?? "";

  const selectedOrigin =
    originKey.length > 0
      ? (bungalowOptions.find(
          (bungalow) => getBungalowKey(bungalow) === originKey,
        ) ??
        (!isWalletScoped &&
        defaultOriginBungalow &&
        getBungalowKey(defaultOriginBungalow) === originKey
          ? defaultOriginBungalow
          : null))
      : null;

  const draftItem = useMemo<BodegaCatalogItem>(() => {
    const content = buildContentPayload({
      assetType,
      artFormat,
      title: resolvedTitle,
      description: resolvedDescription,
      previewUrl: resolvedPreviewUrl,
      url,
    });

    return {
      id: 0,
      creator_wallet: creatorWallet,
      creator_handle: null,
      origin_bungalow_token_address: selectedOrigin?.token_address ?? null,
      origin_bungalow_chain: selectedOrigin?.chain ?? null,
      asset_type: assetType,
      title: resolvedTitle || `Untitled ${listingTitle}`,
      description: resolvedDescription || null,
      content,
      preview_url: resolvedPreviewUrl || null,
      price_in_jbm: price.trim() || "0",
      install_count: 0,
      active: true,
      submission_tx_hash: null,
      submission_fee_jbm: null,
      created_at: new Date().toISOString(),
    };
  }, [
    assetType,
    artFormat,
    buildMetadata?.description,
    buildMetadata?.image,
    buildMetadata?.title,
    creatorWallet,
    listingTitle,
    price,
    resolvedDescription,
    resolvedPreviewUrl,
    resolvedTitle,
    selectedOrigin,
    url,
  ]);
  const draftFingerprint = useMemo(
    () =>
      JSON.stringify({
        listingType,
        artFormat,
        title: resolvedTitle,
        description: resolvedDescription,
        price: price.trim(),
        previewUrl: resolvedPreviewUrl,
        url: url.trim(),
        originKey,
      }),
    [
      artFormat,
      listingType,
      originKey,
      price,
      resolvedDescription,
      resolvedPreviewUrl,
      resolvedTitle,
      url,
    ],
  );

  const submittedItemPath = useMemo(
    () => getBodegaListingPath(submittedItem?.submission_tx_hash),
    [submittedItem?.submission_tx_hash],
  );
  const hasCreatorWallet = creatorWallet.length > 0;
  const minimumPublishHeat = publishEligibility?.minimum_heat ?? 25;
  const eligibilitySummary = publishEligibility
    ? `Current heat: ${publishEligibility.island_heat.toFixed(1)}. Required: ${publishEligibility.minimum_heat.toFixed(0)}.`
    : null;
  const blockedByHeatGate =
    !submittedItem &&
    hasCreatorWallet &&
    !isEligibilityLoading &&
    !eligibilityError &&
    publishEligibility?.can_publish === false;
  const submitBlockedByEligibility =
    step === 3 &&
    !submittedItem &&
    (!hasCreatorWallet ||
      isEligibilityLoading ||
      Boolean(eligibilityError) ||
      !publishEligibility ||
      !publishEligibility.can_publish);

  if (!open) return null;

  const handleStepAdvance = () => {
    setError(null);

    if (blockedByHeatGate) {
      setError(
        `You need at least ${minimumPublishHeat.toFixed(0)} island heat to publish. Current heat: ${publishEligibility?.island_heat.toFixed(1) ?? "0.0"}.`,
      );
      return;
    }

    if (step === 1) {
      setStep(2);
      return;
    }

    const validation = validateDraft({
      assetType,
      artFormat,
      title,
      price,
      previewUrl,
      url,
    });

    if (validation.firstInvalidField) {
      setFieldErrors(validation.fieldErrors);
      setPendingFocusField(validation.firstInvalidField);
      return;
    }

    setFieldErrors({});
    setStep(3);
  };

  const handleSubmit = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const reusablePayment = Boolean(
      pendingPayment &&
        pendingPayment.draftFingerprint === draftFingerprint &&
        /^0x[0-9a-fA-F]{64}$/.test(pendingPayment.txHash),
    );
    const payoutWallet = selectedPayWallet || walletAddress;
    if (
      !reusablePayment &&
      (!payoutWallet || !walletSelectorState.selectedWalletAvailable)
    ) {
      setError("Choose a wallet that is available here or link a new one.");
      return;
    }

    const validation = validateDraft({
      assetType,
      artFormat,
      title,
      price,
      previewUrl,
      url,
    });

    if (validation.firstInvalidField) {
      setFieldErrors(validation.fieldErrors);
      setStep(2);
      setPendingFocusField(validation.firstInvalidField);
      return;
    }

    if (isEligibilityLoading) {
      setError("Checking island heat for this wallet. Try again in a moment.");
      return;
    }

    if (!publishEligibility) {
      setError(
        eligibilityError ??
          "Could not verify island heat for this wallet. Try again before paying.",
      );
      return;
    }

    if (!publishEligibility.can_publish) {
      const baseMessage = `You need at least ${publishEligibility.minimum_heat.toFixed(0)} island heat to publish live listings. Current heat: ${publishEligibility.island_heat.toFixed(1)}.`;
      setError(
        reusablePayment
          ? `${baseMessage} Your publishing fee is already recorded and can be reused once this wallet cluster qualifies.`
          : baseMessage,
      );
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    setError(null);
    setStatus(
      `Waiting for the ${formatJbmAmount(BODEGA_SUBMISSION_FEE)} publishing fee confirmation...`,
    );

    let usedExistingPayment = false;
    let confirmedPayment: PendingSubmissionPayment | null = null;

    try {
      if (reusablePayment) {
        usedExistingPayment = true;
        confirmedPayment = pendingPayment;
      } else {
        const transferResult = await transfer(BODEGA_SUBMISSION_FEE);
        confirmedPayment = {
          draftFingerprint,
          txHash: transferResult.hash,
          payer: transferResult.from,
        };
        setPendingPayment(confirmedPayment);
      }

      setStatus("Publishing your listing to the Bodega...");

      if (!confirmedPayment) {
        throw new Error("Missing publishing fee confirmation");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/bodega/submit", {
        method: "POST",
        headers,
        body: JSON.stringify({
          creator_wallet: confirmedPayment.payer,
          asset_type: assetType,
          title: resolvedTitle,
          description: resolvedDescription || undefined,
          content: draftItem.content,
          preview_url: draftItem.preview_url ?? undefined,
          price_in_jbm: asPositiveNumber(price),
          tx_hash: confirmedPayment.txHash,
          jbm_amount: String(BODEGA_SUBMISSION_FEE),
          origin_bungalow_token_address: selectedOrigin?.token_address,
          origin_bungalow_chain: selectedOrigin?.chain,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        item?: unknown;
        error?: unknown;
      } | null;

      const item = normalizeBodegaCatalogItem(data?.item);
      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok || !item) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      setPendingPayment(null);
      setSubmittedItem(item);
      setStatus("Your listing is live in the Bodega.");
      onSubmitted?.(item);
    } catch (err) {
      setStatus(null);
      const message =
        err instanceof Error ? err.message : "Failed to submit Bodega listing";
      if (usedExistingPayment || Boolean(confirmedPayment)) {
        setError(
          `${message}. The ${formatJbmAmount(BODEGA_SUBMISSION_FEE)} publishing fee is already paid, so you can retry without paying again.`,
        );
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareListing = async () => {
    if (!submittedItemPath) {
      setShareStatus("This listing does not have a shareable URL yet.");
      return;
    }

    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${submittedItemPath}`
        : submittedItemPath;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("Listing link copied.");
    } catch {
      setShareStatus("Could not copy the link automatically.");
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h3>Submit to the Bodega</h3>
            <p>
              Publish one reusable listing. A one-time{" "}
              {formatJbmAmount(BODEGA_SUBMISSION_FEE)} publishing fee is charged
              when you submit, the listing goes live immediately, and you earn
              30% every time another bungalow pays to install it. Publishing
              currently requires at least 25 island heat.
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

        <div className={styles.stepRail}>
          <span className={step >= 1 ? styles.stepActive : ""}>1. Type</span>
          <span className={step >= 2 ? styles.stepActive : ""}>2. Details</span>
          <span className={step >= 3 ? styles.stepActive : ""}>3. Preview</span>
        </div>

        <WalletSelector
          label="Sign with"
          panelMode="inline"
          value={selectedPayWallet}
          onSelect={(address) => {
            setSelectedPayWallet(address);
            setError(null);
          }}
          onStateChange={setWalletSelectorState}
        />

        {!submittedItem ? (
          <section
            className={`${styles.eligibilityCard} ${
              !hasCreatorWallet
                ? styles.eligibilityBlocked
                : isEligibilityLoading
                ? styles.eligibilityChecking
                : publishEligibility?.can_publish
                  ? styles.eligibilityReady
                  : styles.eligibilityBlocked
            }`}
          >
            <div className={styles.eligibilityHeader}>
              <strong>Publishing gate</strong>
              <span>
                {!hasCreatorWallet
                  ? "Choose wallet"
                  : isEligibilityLoading
                  ? "Checking heat..."
                  : publishEligibility?.can_publish
                    ? "Ready to publish"
                    : eligibilityError
                      ? "Could not verify"
                      : "Heat too low"}
              </span>
            </div>
            <div className={styles.eligibilityStats}>
              <span>
                Current heat{" "}
                <strong>
                  {publishEligibility
                    ? publishEligibility.island_heat.toFixed(1)
                    : "—"}
                </strong>
              </span>
              <span>
                Required{" "}
                <strong>{minimumPublishHeat.toFixed(0)}</strong>
              </span>
            </div>
            <p className={styles.eligibilityBody}>
              {!hasCreatorWallet
                ? "Choose a wallet first so the Bodega can verify the heat gate before any publishing fee is charged."
                : isEligibilityLoading
                ? "Checking whether the selected wallet cluster can publish before any JBM fee is charged."
                : eligibilityError
                  ? `${eligibilityError} The publishing fee stays blocked until this check succeeds.`
                  : publishEligibility?.can_publish
                    ? "This wallet cluster clears the live-publishing threshold, so the Bodega fee can be charged safely."
                    : "This wallet cluster is below the live-publishing threshold. The publish fee button stays blocked until the required island heat is reached."}
            </p>
          </section>
        ) : null}

        {submittedItem ? (
          <section className={styles.successSection}>
            <BodegaCard
              item={submittedItem}
              originBungalow={selectedOrigin}
              actionLabel="Just Submitted"
              compact={false}
            />
            <div className={styles.successActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void handleShareListing();
                }}
              >
                Share
              </button>
              {submittedItemPath ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    navigate(submittedItemPath);
                    onClose();
                  }}
                >
                  View listing
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={onClose}
              >
                Back to listing
              </button>
            </div>
            {shareStatus ? (
              <div className={styles.status}>{shareStatus}</div>
            ) : null}
          </section>
        ) : null}

        {!submittedItem && step === 1 ? (
          <section className={styles.typeGrid}>
            <button
              type="button"
              className={`${styles.typeCard} ${
                listingType === "art" ? styles.typeCardActive : ""
              }`}
              onClick={() => setListingType("art")}
            >
              <span className={styles.typeIcon}>
                {getBodegaAssetIcon("decoration")}
              </span>
              <strong>Art</strong>
              <small>Images and GLB-based decorative assets.</small>
            </button>
            <button
              type="button"
              className={`${styles.typeCard} ${
                listingType === "miniapp" ? styles.typeCardActive : ""
              }`}
              onClick={() => setListingType("miniapp")}
            >
              <span className={styles.typeIcon}>
                {getBodegaAssetIcon("miniapp")}
              </span>
              <strong>Build</strong>
              <small>
                Paste a link and let the Bodega pull the metadata automatically.
              </small>
            </button>
          </section>
        ) : null}

        {!submittedItem && step === 2 ? (
          <section className={styles.formGrid}>
            {assetType === "decoration" ? (
              <>
                <label className={styles.field}>
                  Title
                  <input
                    ref={titleInputRef}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      clearFieldError("title");
                    }}
                    placeholder={`${listingTitle} title`}
                    aria-invalid={Boolean(fieldErrors.title)}
                  />
                  {fieldErrors.title ? (
                    <span className={styles.fieldErrorText}>
                      {fieldErrors.title}
                    </span>
                  ) : null}
                </label>

                <label className={styles.field}>
                  Description
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    placeholder="Tell people what this adds to a bungalow."
                  />
                </label>

                <label className={styles.field}>
                  Art format
                  <select
                    value={artFormat}
                    onChange={(event) => {
                      setArtFormat(event.target.value as ArtFormat);
                      clearFieldError("previewUrl");
                      clearFieldError("url");
                    }}
                  >
                    <option value="image">Image</option>
                    <option value="glb">GLB 3D asset</option>
                  </select>
                  <small>
                    Start with flat art now, or list a GLB file for future 3D
                    bungalow installs.
                  </small>
                </label>
                <label className={styles.field}>
                  {artFormat === "glb" ? "Preview image URL" : "Art image URL"}
                  <input
                    ref={previewUrlInputRef}
                    value={previewUrl}
                    onChange={(event) => {
                      setPreviewUrl(event.target.value);
                      clearFieldError("previewUrl");
                    }}
                    placeholder="https://..."
                    aria-invalid={Boolean(fieldErrors.previewUrl)}
                  />
                  {fieldErrors.previewUrl ? (
                    <span className={styles.fieldErrorText}>
                      {fieldErrors.previewUrl}
                    </span>
                  ) : null}
                  <small>
                    {artFormat === "glb"
                      ? "Use a thumbnail or poster image so the listing previews cleanly."
                      : "This image is both the listing preview and the installed art."}
                  </small>
                </label>
                {artFormat === "glb" ? (
                  <label className={styles.field}>
                    GLB file URL
                    <input
                      ref={urlInputRef}
                      value={url}
                      onChange={(event) => {
                        setUrl(event.target.value);
                        clearFieldError("url");
                      }}
                      placeholder="https://.../asset.glb"
                      aria-invalid={Boolean(fieldErrors.url)}
                    />
                    {fieldErrors.url ? (
                      <span className={styles.fieldErrorText}>
                        {fieldErrors.url}
                      </span>
                    ) : null}
                    <small>
                      Export from Blender as `.glb`, host the file, and paste
                      the public URL here.
                    </small>
                  </label>
                ) : null}
              </>
            ) : null}

            {assetType === "miniapp" ? (
              <>
                <label className={styles.field}>
                  Build URL
                  <input
                    ref={urlInputRef}
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      clearFieldError("url");
                    }}
                    placeholder="https://..."
                    aria-invalid={Boolean(fieldErrors.url)}
                  />
                  {fieldErrors.url ? (
                    <span className={styles.fieldErrorText}>
                      {fieldErrors.url}
                    </span>
                  ) : null}
                  <small>
                    Paste the public link. The Bodega will fill in the title,
                    description, and preview image from that page.
                  </small>
                </label>

                {isHttpUrl(url.trim()) ? (
                  <div className={styles.metadataCard}>
                    <strong>Detected preview</strong>
                    {isBuildMetadataLoading ? (
                      <span className={styles.metadataNote}>
                        Reading metadata from that link...
                      </span>
                    ) : (
                      <div className={styles.metadataGrid}>
                        {resolvedPreviewUrl ? (
                          <img
                            src={resolvedPreviewUrl}
                            alt={resolvedTitle || "Build preview"}
                            className={styles.metadataPreview}
                          />
                        ) : (
                          <div className={styles.metadataPlaceholder}>
                            No preview image found yet
                          </div>
                        )}
                        <div className={styles.metadataContent}>
                          <strong>{resolvedTitle || "Untitled Build"}</strong>
                          <p>
                            {resolvedDescription ||
                              "No description was found on this page yet."}
                          </p>
                          {buildMetadataError ? (
                            <span className={styles.metadataWarning}>
                              {buildMetadataError}
                            </span>
                          ) : null}
                          {buildMetadata?.missingFields.length ? (
                            <span className={styles.metadataWarning}>
                              Missing metadata: {buildMissingMetadataDetails}.
                              Add those tags on the linked page so this build
                              previews cleanly in the Bodega.
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            <label className={styles.field}>
              Install price in JBM
              <input
                ref={priceInputRef}
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                  clearFieldError("price");
                }}
                inputMode="decimal"
                placeholder="50000"
                aria-invalid={Boolean(fieldErrors.price)}
              />
              {fieldErrors.price ? (
                <span className={styles.fieldErrorText}>
                  {fieldErrors.price}
                </span>
              ) : null}
              <small>
                This is the amount another bungalow pays each time it installs
                this listing. You receive 30% of each paid install.
              </small>
            </label>

            {isWalletScoped &&
            bungalowOptions.length === 0 &&
            !isDirectoryLoading ? (
              <div className={styles.lockedField}>
                <span>Originating bungalow (optional)</span>
                <strong>You don't own any bungalows yet.</strong>
                <small>
                  You can still submit without a source bungalow. Bungalows are
                  community property now, and new ones open through heat/support
                  qualification on the island page.
                </small>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    navigate("/");
                    onClose();
                  }}
                >
                  Open island
                </button>
              </div>
            ) : (
              <label className={styles.field}>
                Originating bungalow
                <BungalowOptionPicker
                  options={bungalowOptions}
                  selectedKey={originKey}
                  onSelect={setOriginKey}
                  allowEmpty
                  emptyLabel="No specific origin"
                />
                <small>
                  {selectionNote ??
                    (isDirectoryLoading
                      ? isWalletScoped
                        ? "Loading your bungalows..."
                        : "Loading the island directory..."
                      : "Origin tags are optional.")}
                </small>
              </label>
            )}
          </section>
        ) : null}

        {!submittedItem && step === 3 ? (
          <section className={styles.previewSection}>
            <BodegaCard
              item={draftItem}
              originBungalow={selectedOrigin}
              actionLabel="Preview"
              compact={false}
            />
            <div className={styles.feeCard}>
              <strong>
                One-time publishing fee:{" "}
                {formatJbmAmount(BODEGA_SUBMISSION_FEE)}
              </strong>
              <span>
                This fee is paid once when the listing is first published. It is
                separate from the install price charged to future buyers.
              </span>
            </div>
          </section>
        ) : null}

        {!submittedItem ? (
          <footer className={styles.footer}>
            <div className={styles.feedback}>
              {status ? <span className={styles.status}>{status}</span> : null}
              {error ? <span className={styles.error}>{error}</span> : null}
              {!status && !error && step === 3 && eligibilitySummary ? (
                <span className={styles.status}>{eligibilitySummary}</span>
              ) : null}
            </div>
            <div className={styles.actions}>
              {step > 1 ? (
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={() => {
                    setError(null);
                    setStep((current) =>
                      current > 1 ? ((current - 1) as ModalStep) : current,
                    );
                  }}
                  disabled={isSubmitting}
                  aria-label="Go back"
                >
                  ←
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={step === 3 ? handleSubmit : handleStepAdvance}
                disabled={
                  isSubmitting ||
                  isTransferring ||
                  submitBlockedByEligibility ||
                  (step < 3 && blockedByHeatGate)
                }
              >
                {isSubmitting || isTransferring
                  ? "Submitting..."
                  : step === 3 && isEligibilityLoading
                    ? "Checking heat..."
                    : step === 3 && !hasCreatorWallet
                      ? "Choose wallet first"
                    : step === 3 && eligibilityError
                      ? "Verify heat first"
                      : blockedByHeatGate
                        ? `Need ${minimumPublishHeat.toFixed(0)} Heat`
                        : step === 3
                          ? pendingPayment &&
                            pendingPayment.draftFingerprint === draftFingerprint
                            ? "Retry Save"
                            : `Pay ${formatJbmAmount(BODEGA_SUBMISSION_FEE)} & Submit`
                          : "Continue"}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
