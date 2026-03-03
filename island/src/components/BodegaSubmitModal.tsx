import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import BodegaCard from "./BodegaCard";
import BungalowOptionPicker from "./BungalowOptionPicker";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import { formatJbmAmount } from "../utils/formatters";
import styles from "../styles/bodega-submit-modal.module.css";
import {
  BODEGA_ASSET_DESCRIPTIONS,
  BODEGA_ASSET_LABELS,
  BODEGA_ASSET_SINGULAR_LABELS,
  getBodegaAssetIcon,
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

type ModalStep = 1 | 2 | 3;
const BODEGA_SUBMISSION_FEE = 69_000;

interface PendingSubmissionPayment {
  draftFingerprint: string;
  txHash: string;
  payer: string;
}

type DraftFieldKey =
  | "title"
  | "price"
  | "previewUrl"
  | "externalUrl"
  | "url"
  | "imageUrl";

type DraftFieldErrors = Partial<Record<DraftFieldKey, string>>;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
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

function getFirstInvalidField(
  errors: DraftFieldErrors,
): DraftFieldKey | null {
  const orderedFields: DraftFieldKey[] = [
    "title",
    "previewUrl",
    "externalUrl",
    "url",
    "imageUrl",
    "price",
  ];

  return orderedFields.find((field) => Boolean(errors[field])) ?? null;
}

/**
 * Builds the type-specific content payload expected by the Bodega submit API.
 */
function buildContentPayload(input: {
  assetType: BodegaAssetType;
  title: string;
  description: string;
  previewUrl: string;
  externalUrl: string;
  url: string;
  caption: string;
  imageUrl: string;
}): Record<string, string> {
  if (input.assetType === "decoration") {
    return {
      preview_url: input.previewUrl,
      external_url: input.externalUrl,
      format: "image",
    };
  }

  if (input.assetType === "game" || input.assetType === "miniapp") {
    return {
      url: input.url,
      name: input.title,
      description: input.description,
    };
  }

  if (input.assetType === "link") {
    return {
      url: input.url,
      title: input.title,
    };
  }

  return {
    image_url: input.imageUrl,
    caption: input.caption,
  };
}

/**
 * Validates the current draft before the preview or submit step.
 */
function validateDraft(input: {
  assetType: BodegaAssetType;
  title: string;
  price: string;
  previewUrl: string;
  externalUrl: string;
  url: string;
  imageUrl: string;
}): {
  fieldErrors: DraftFieldErrors;
  firstInvalidField: DraftFieldKey | null;
} {
  const fieldErrors: DraftFieldErrors = {};

  if (!input.title.trim()) {
    fieldErrors.title = "Give this listing a title.";
  }

  if (asPositiveNumber(input.price) === null) {
    fieldErrors.price = "Set a positive JBM install price.";
  }

  if (input.assetType === "decoration") {
    if (!isHttpUrl(input.previewUrl)) {
      fieldErrors.previewUrl =
        "Decoration preview image must be a valid http(s) URL.";
    }
    if (!isHttpUrl(input.externalUrl)) {
      fieldErrors.externalUrl =
        "Decoration external URL must be a valid http(s) URL.";
    }
  }

  if (input.assetType === "game" || input.assetType === "miniapp") {
    if (!isHttpUrl(input.url)) {
      fieldErrors.url = "Games and miniapps need a valid http(s) URL.";
    }
  }

  if (input.assetType === "link") {
    if (!isHttpUrl(input.url)) {
      fieldErrors.url = "Links need a valid http(s) URL.";
    }
  }

  if (input.assetType === "image") {
    if (!isHttpUrl(input.imageUrl)) {
      fieldErrors.imageUrl = "Images need a valid http(s) image URL.";
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
  const { authenticated, getAccessToken, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { transfer, isTransferring } = useJBMTransfer();

  const [step, setStep] = useState<ModalStep>(1);
  const [assetType, setAssetType] = useState<BodegaAssetType>("decoration");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("50000");
  const [previewUrl, setPreviewUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [originKey, setOriginKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DraftFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPayment, setPendingPayment] =
    useState<PendingSubmissionPayment | null>(null);
  const [pendingFocusField, setPendingFocusField] = useState<DraftFieldKey | null>(
    null,
  );
  const [submittedItem, setSubmittedItem] = useState<BodegaCatalogItem | null>(
    null,
  );
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlInputRef = useRef<HTMLInputElement | null>(null);
  const externalUrlInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const imageUrlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;

    setStep(1);
    setAssetType("decoration");
    setTitle("");
    setDescription("");
    setPrice("50000");
    setPreviewUrl("");
    setExternalUrl("");
    setUrl("");
    setCaption("");
    setImageUrl("");
    const preferredKey = defaultOriginBungalow
      ? getBungalowKey(defaultOriginBungalow)
      : "";
    const hasPreferred = bungalowOptions.some(
      (bungalow) => getBungalowKey(bungalow) === preferredKey,
    );
    setOriginKey(
      hasPreferred
        ? preferredKey
        : bungalowOptions[0]
          ? getBungalowKey(bungalowOptions[0])
          : !isWalletScoped
            ? preferredKey
            : "",
    );
    setStatus(null);
    setError(null);
    setFieldErrors({});
    setIsSubmitting(false);
    setPendingPayment(null);
    setPendingFocusField(null);
    setSubmittedItem(null);
  }, [bungalowOptions, defaultOriginBungalow, isWalletScoped, open]);

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

  const getFieldTarget = (
    field: DraftFieldKey,
  ): HTMLInputElement | null => {
    if (field === "title") return titleInputRef.current;
    if (field === "price") return priceInputRef.current;
    if (field === "previewUrl") return previewUrlInputRef.current;
    if (field === "externalUrl") return externalUrlInputRef.current;
    if (field === "url") return urlInputRef.current;
    if (field === "imageUrl") return imageUrlInputRef.current;
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

  const creatorWallet =
    user?.wallet?.address ??
    (wallets.length > 0 ? wallets[0].address : "");

  const selectedOrigin =
    bungalowOptions.find((bungalow) => getBungalowKey(bungalow) === originKey) ??
    (!isWalletScoped ? defaultOriginBungalow ?? null : null);

  const draftItem = useMemo<BodegaCatalogItem>(() => {
    const content = buildContentPayload({
      assetType,
      title,
      description,
      previewUrl,
      externalUrl,
      url,
      caption,
      imageUrl,
    });

    return {
      id: 0,
      creator_wallet: creatorWallet,
      creator_handle: null,
      origin_bungalow_token_address: selectedOrigin?.token_address ?? null,
      origin_bungalow_chain: selectedOrigin?.chain ?? null,
      asset_type: assetType,
      title: title.trim() || `Untitled ${BODEGA_ASSET_SINGULAR_LABELS[assetType]}`,
      description: description.trim() || null,
      content,
      preview_url:
        assetType === "decoration"
          ? previewUrl.trim() || null
          : assetType === "image"
            ? imageUrl.trim() || null
            : null,
      price_in_jbm: price.trim() || "0",
      install_count: 0,
      active: true,
      created_at: new Date().toISOString(),
    };
  }, [
    assetType,
    caption,
    creatorWallet,
    description,
    externalUrl,
    imageUrl,
    previewUrl,
    price,
    selectedOrigin,
    title,
    url,
  ]);
  const draftFingerprint = useMemo(
    () =>
      JSON.stringify({
        assetType,
        title: title.trim(),
        description: description.trim(),
        price: price.trim(),
        previewUrl: previewUrl.trim(),
        externalUrl: externalUrl.trim(),
        url: url.trim(),
        imageUrl: imageUrl.trim(),
        caption: caption.trim(),
        originKey,
      }),
    [
      assetType,
      caption,
      description,
      externalUrl,
      imageUrl,
      originKey,
      previewUrl,
      price,
      title,
      url,
    ],
  );

  if (!open) return null;

  const handleStepAdvance = () => {
    setError(null);

    if (step === 1) {
      setStep(2);
      return;
    }

    const validation = validateDraft({
      assetType,
      title,
      price,
      previewUrl,
      externalUrl,
      url,
      imageUrl,
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

    const validation = validateDraft({
      assetType,
      title,
      price,
      previewUrl,
      externalUrl,
      url,
      imageUrl,
    });

    if (validation.firstInvalidField) {
      setFieldErrors(validation.fieldErrors);
      setStep(2);
      setPendingFocusField(validation.firstInvalidField);
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
      const reusablePayment =
        pendingPayment &&
        pendingPayment.draftFingerprint === draftFingerprint &&
        /^0x[0-9a-fA-F]{64}$/.test(pendingPayment.txHash);

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
          asset_type: assetType,
          title: title.trim(),
          description: description.trim() || undefined,
          content: draftItem.content,
          preview_url: draftItem.preview_url ?? undefined,
          price_in_jbm: asPositiveNumber(price),
          tx_hash: confirmedPayment.txHash,
          jbm_amount: BODEGA_SUBMISSION_FEE,
          origin_bungalow_token_address: selectedOrigin?.token_address,
          origin_bungalow_chain: selectedOrigin?.chain,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            item?: unknown;
            error?: unknown;
          }
        | null;

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
      if (
        usedExistingPayment ||
        Boolean(confirmedPayment)
      ) {
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

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h3>Submit to the Bodega</h3>
            <p>
              Publish one reusable listing. A one-time{" "}
              {formatJbmAmount(BODEGA_SUBMISSION_FEE)} publishing fee is charged
              when you submit, then you earn 30% every time another bungalow
              pays to install it.
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

        {submittedItem ? (
          <section className={styles.successSection}>
            <BodegaCard
              item={submittedItem}
              originBungalow={selectedOrigin}
              actionLabel="Just Submitted"
            />
            <div className={styles.successActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={onClose}
              >
                Back to listing
              </button>
            </div>
          </section>
        ) : null}

        {!submittedItem && step === 1 ? (
          <section className={styles.typeGrid}>
            {(Object.keys(BODEGA_ASSET_LABELS) as BodegaAssetType[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`${styles.typeCard} ${
                  assetType === key ? styles.typeCardActive : ""
                }`}
                onClick={() => setAssetType(key)}
              >
                <span className={styles.typeIcon}>{getBodegaAssetIcon(key)}</span>
                <strong>{BODEGA_ASSET_SINGULAR_LABELS[key]}</strong>
                <small>{BODEGA_ASSET_DESCRIPTIONS[key]}</small>
              </button>
            ))}
          </section>
        ) : null}

        {!submittedItem && step === 2 ? (
          <section className={styles.formGrid}>
            <label className={styles.field}>
              Title
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  clearFieldError("title");
                }}
                placeholder={`${BODEGA_ASSET_SINGULAR_LABELS[assetType]} title`}
                aria-invalid={Boolean(fieldErrors.title)}
              />
              {fieldErrors.title ? (
                <span className={styles.fieldErrorText}>{fieldErrors.title}</span>
              ) : null}
            </label>

            {assetType !== "link" && assetType !== "image" ? (
              <label className={styles.field}>
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Tell other bungalows why this belongs in the room."
                />
              </label>
            ) : null}

            {assetType === "decoration" ? (
              <>
                <label className={styles.field}>
                  Preview image URL
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
                </label>
                <label className={styles.field}>
                  External URL
                  <input
                    ref={externalUrlInputRef}
                    value={externalUrl}
                    onChange={(event) => {
                      setExternalUrl(event.target.value);
                      clearFieldError("externalUrl");
                    }}
                    placeholder="https://..."
                    aria-invalid={Boolean(fieldErrors.externalUrl)}
                  />
                  {fieldErrors.externalUrl ? (
                    <span className={styles.fieldErrorText}>
                      {fieldErrors.externalUrl}
                    </span>
                  ) : null}
                </label>
                <div className={styles.lockedField}>
                  <span>Accepted format</span>
                  <strong>Image only</strong>
                  <small>
                    This form only supports image-based decorations right now.
                    GLB and USDZ decoration uploads are not available yet.
                  </small>
                </div>
              </>
            ) : null}

            {assetType === "game" || assetType === "miniapp" ? (
              <label className={styles.field}>
                URL
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
                  <span className={styles.fieldErrorText}>{fieldErrors.url}</span>
                ) : null}
              </label>
            ) : null}

            {assetType === "link" ? (
              <label className={styles.field}>
                URL
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
                  <span className={styles.fieldErrorText}>{fieldErrors.url}</span>
                ) : null}
              </label>
            ) : null}

            {assetType === "image" ? (
              <>
                <label className={styles.field}>
                  Image URL
                  <input
                    ref={imageUrlInputRef}
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      clearFieldError("imageUrl");
                    }}
                    placeholder="https://..."
                    aria-invalid={Boolean(fieldErrors.imageUrl)}
                  />
                  {fieldErrors.imageUrl ? (
                    <span className={styles.fieldErrorText}>
                      {fieldErrors.imageUrl}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  Caption
                  <input
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    placeholder="Optional caption"
                  />
                </label>
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
                <span className={styles.fieldErrorText}>{fieldErrors.price}</span>
              ) : null}
              <small>
                This is the amount another bungalow pays each time it installs
                this listing. You receive 30% of each paid install.
              </small>
            </label>

            {isWalletScoped && bungalowOptions.length === 0 && !isDirectoryLoading ? (
              <div className={styles.lockedField}>
                <span>Originating bungalow (optional)</span>
                <strong>You don't own any bungalows yet.</strong>
                <small>
                  You can still submit without a source bungalow, or claim one first.
                </small>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    navigate("/");
                    onClose();
                  }}
                >
                  Find one to claim
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
            />
            <div className={styles.feeCard}>
              <strong>
                One-time publishing fee: {formatJbmAmount(BODEGA_SUBMISSION_FEE)}
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
            </div>
            <div className={styles.actions}>
              {step > 1 ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setError(null);
                    setStep((current) => (current > 1 ? ((current - 1) as ModalStep) : current));
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={step === 3 ? handleSubmit : handleStepAdvance}
                disabled={isSubmitting || isTransferring}
              >
                  {isSubmitting || isTransferring
                    ? "Submitting..."
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
