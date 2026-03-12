import type { DirectoryBungalow } from "./bodega";

export type CommissionStatus =
  | "draft"
  | "open"
  | "claimed"
  | "submitted"
  | "disputed"
  | "completed"
  | "cancelled";

export type CommissionApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export interface CommissionRecord {
  brief_id: string;
  commission_id: number | null;
  requester_privy_user_id: string;
  requester_wallet: string;
  requester_profile_id: number | null;
  requester_handle: string | null;
  bungalow_chain: string;
  bungalow_token_address: string;
  bungalow_name: string | null;
  rate_label: string;
  prompt: string;
  brief_uri: string;
  budget_jbm: string;
  claim_deadline: string;
  delivery_deadline: string;
  status: CommissionStatus;
  created_tx_hash: string | null;
  approved_application_id: number | null;
  approved_artist_wallet: string | null;
  approved_artist_profile_id: number | null;
  approved_artist_handle: string | null;
  artist_wallet: string | null;
  artist_profile_id: number | null;
  artist_handle: string | null;
  claimed_tx_hash: string | null;
  submitted_tx_hash: string | null;
  approved_tx_hash: string | null;
  cancelled_tx_hash: string | null;
  payout_claim_tx_hash: string | null;
  deliverable_uri: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  applications_count: number;
  pending_applications: number;
  viewer_application: {
    id: number;
    status: CommissionApplicationStatus;
  } | null;
}

export interface CommissionApplication {
  id: number;
  commission_id: number;
  artist_privy_user_id: string;
  artist_wallet: string;
  artist_profile_id: number | null;
  artist_handle: string | null;
  message: string | null;
  status: CommissionApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface CommissionViewerState {
  authenticated: boolean;
  profile_id: number | null;
  wallets: string[];
  is_requester?: boolean;
  is_approved_artist?: boolean;
  is_artist?: boolean;
  can_apply?: boolean;
  can_approve_artist?: boolean;
  can_claim?: boolean;
  can_submit?: boolean;
  can_approve_completion?: boolean;
  can_cancel?: boolean;
  can_claim_timeout_payout?: boolean;
}

export interface CommissionListResponse {
  items: CommissionRecord[];
  total: number;
  scope: string;
  viewer: CommissionViewerState;
}

export interface CommissionDetailResponse {
  commission: CommissionRecord | null;
  applications: CommissionApplication[];
  viewer: CommissionViewerState;
}

export interface CommissionDraftResponse {
  brief_id: string;
  brief_uri: string;
  requester_wallet: string;
  requester_profile_id: number;
  requester_handle: string | null;
  bungalow: {
    chain: string;
    token_address: string;
    name: string | null;
    contract_bungalow_id: number | null;
  };
  rate_label: string;
  prompt: string;
  budget_jbm: string;
  budget_wei: string;
  claim_deadline: number;
  delivery_deadline: number;
  contract_address: string | null;
}

function asObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function asNumber(input: unknown): number {
  const numeric = Number(input ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asBoolean(input: unknown): boolean {
  return Boolean(input);
}

export function normalizeCommissionRecord(input: unknown): CommissionRecord | null {
  const item = asObject(input);
  const briefId = asString(item.brief_id);
  const requesterWallet = asString(item.requester_wallet);
  const bungalowChain = asString(item.bungalow_chain);
  const bungalowTokenAddress = asString(item.bungalow_token_address);
  const rateLabel = asString(item.rate_label);
  const prompt = asString(item.prompt);
  const briefUri = asString(item.brief_uri);
  const budgetJbm = asString(item.budget_jbm);
  const status = asString(item.status) as CommissionStatus;
  const createdAt = asString(item.created_at);
  const updatedAt = asString(item.updated_at);

  if (
    !briefId ||
    !requesterWallet ||
    !bungalowChain ||
    !bungalowTokenAddress ||
    !rateLabel ||
    !prompt ||
    !briefUri ||
    !budgetJbm ||
    !status ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const viewerApplication = asObject(item.viewer_application);
  const viewerApplicationId = asNumber(viewerApplication.id);
  const viewerApplicationStatus = asString(
    viewerApplication.status,
  ) as CommissionApplicationStatus;

  return {
    brief_id: briefId,
    commission_id: asNumber(item.commission_id) || null,
    requester_privy_user_id: asString(item.requester_privy_user_id),
    requester_wallet: requesterWallet,
    requester_profile_id: asNumber(item.requester_profile_id) || null,
    requester_handle: asString(item.requester_handle) || null,
    bungalow_chain: bungalowChain,
    bungalow_token_address: bungalowTokenAddress,
    bungalow_name: asString(item.bungalow_name) || null,
    rate_label: rateLabel,
    prompt,
    brief_uri: briefUri,
    budget_jbm: budgetJbm,
    claim_deadline: asString(item.claim_deadline),
    delivery_deadline: asString(item.delivery_deadline),
    status,
    created_tx_hash: asString(item.created_tx_hash) || null,
    approved_application_id: asNumber(item.approved_application_id) || null,
    approved_artist_wallet: asString(item.approved_artist_wallet) || null,
    approved_artist_profile_id:
      asNumber(item.approved_artist_profile_id) || null,
    approved_artist_handle: asString(item.approved_artist_handle) || null,
    artist_wallet: asString(item.artist_wallet) || null,
    artist_profile_id: asNumber(item.artist_profile_id) || null,
    artist_handle: asString(item.artist_handle) || null,
    claimed_tx_hash: asString(item.claimed_tx_hash) || null,
    submitted_tx_hash: asString(item.submitted_tx_hash) || null,
    approved_tx_hash: asString(item.approved_tx_hash) || null,
    cancelled_tx_hash: asString(item.cancelled_tx_hash) || null,
    payout_claim_tx_hash: asString(item.payout_claim_tx_hash) || null,
    deliverable_uri: asString(item.deliverable_uri) || null,
    submitted_at: asString(item.submitted_at) || null,
    created_at: createdAt,
    updated_at: updatedAt,
    applications_count: asNumber(item.applications_count),
    pending_applications: asNumber(item.pending_applications),
    viewer_application:
      viewerApplicationId > 0 && viewerApplicationStatus
        ? {
            id: viewerApplicationId,
            status: viewerApplicationStatus,
          }
        : null,
  };
}

export function normalizeCommissionApplication(
  input: unknown,
): CommissionApplication | null {
  const item = asObject(input);
  const id = asNumber(item.id);
  const commissionId = asNumber(item.commission_id);
  const artistWallet = asString(item.artist_wallet);
  const status = asString(item.status) as CommissionApplicationStatus;
  const createdAt = asString(item.created_at);
  const updatedAt = asString(item.updated_at);

  if (!id || !commissionId || !artistWallet || !status || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    commission_id: commissionId,
    artist_privy_user_id: asString(item.artist_privy_user_id),
    artist_wallet: artistWallet,
    artist_profile_id: asNumber(item.artist_profile_id) || null,
    artist_handle: asString(item.artist_handle) || null,
    message: asString(item.message) || null,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function normalizeCommissionViewer(input: unknown): CommissionViewerState {
  const item = asObject(input);
  const wallets = Array.isArray(item.wallets)
    ? item.wallets
        .map((wallet) => asString(wallet))
        .filter((wallet): wallet is string => Boolean(wallet))
    : [];

  return {
    authenticated: asBoolean(item.authenticated),
    profile_id: asNumber(item.profile_id) || null,
    wallets,
    is_requester: asBoolean(item.is_requester),
    is_approved_artist: asBoolean(item.is_approved_artist),
    is_artist: asBoolean(item.is_artist),
    can_apply: asBoolean(item.can_apply),
    can_approve_artist: asBoolean(item.can_approve_artist),
    can_claim: asBoolean(item.can_claim),
    can_submit: asBoolean(item.can_submit),
    can_approve_completion: asBoolean(item.can_approve_completion),
    can_cancel: asBoolean(item.can_cancel),
    can_claim_timeout_payout: asBoolean(item.can_claim_timeout_payout),
  };
}

export function normalizeCommissionListResponse(
  input: unknown,
): CommissionListResponse {
  const payload = asObject(input);
  const items = Array.isArray(payload.items)
    ? payload.items
        .map((item) => normalizeCommissionRecord(item))
        .filter((item): item is CommissionRecord => item !== null)
    : [];

  return {
    items,
    total: asNumber(payload.total),
    scope: asString(payload.scope) || "open",
    viewer: normalizeCommissionViewer(payload.viewer),
  };
}

export function normalizeCommissionDetailResponse(
  input: unknown,
): CommissionDetailResponse {
  const payload = asObject(input);
  const applications = Array.isArray(payload.applications)
    ? payload.applications
        .map((item) => normalizeCommissionApplication(item))
        .filter((item): item is CommissionApplication => item !== null)
    : [];

  return {
    commission: normalizeCommissionRecord(payload.commission),
    applications,
    viewer: normalizeCommissionViewer(payload.viewer),
  };
}

export function normalizeCommissionDraftResponse(
  input: unknown,
): CommissionDraftResponse | null {
  const payload = asObject(input);
  const briefId = asString(payload.brief_id);
  const briefUri = asString(payload.brief_uri);
  const requesterWallet = asString(payload.requester_wallet);
  const budgetJbm = asString(payload.budget_jbm);
  const budgetWei = asString(payload.budget_wei);
  const bungalow = asObject(payload.bungalow);
  const bungalowChain = asString(bungalow.chain);
  const bungalowTokenAddress = asString(bungalow.token_address);

  if (
    !briefId ||
    !briefUri ||
    !requesterWallet ||
    !budgetJbm ||
    !budgetWei ||
    !bungalowChain ||
    !bungalowTokenAddress
  ) {
    return null;
  }

  return {
    brief_id: briefId,
    brief_uri: briefUri,
    requester_wallet: requesterWallet,
    requester_profile_id: asNumber(payload.requester_profile_id),
    requester_handle: asString(payload.requester_handle) || null,
    bungalow: {
      chain: bungalowChain,
      token_address: bungalowTokenAddress,
      name: asString(bungalow.name) || null,
      contract_bungalow_id: asNumber(bungalow.contract_bungalow_id) || null,
    },
    rate_label: asString(payload.rate_label),
    prompt: asString(payload.prompt),
    budget_jbm: budgetJbm,
    budget_wei: budgetWei,
    claim_deadline: asNumber(payload.claim_deadline),
    delivery_deadline: asNumber(payload.delivery_deadline),
    contract_address: asString(payload.contract_address) || null,
  };
}

export function getCommissionStatusLabel(status: CommissionStatus): string {
  switch (status) {
    case "open":
      return "Open"
    case "claimed":
      return "Claimed"
    case "submitted":
      return "Submitted"
    case "disputed":
      return "Disputed"
    case "completed":
      return "Completed"
    case "cancelled":
      return "Cancelled"
    default:
      return "Draft"
  }
}

export function getCommissionStatusTone(status: CommissionStatus): string {
  switch (status) {
    case "open":
      return "open"
    case "claimed":
      return "claimed"
    case "submitted":
      return "submitted"
    case "completed":
      return "completed"
    case "cancelled":
      return "cancelled"
    case "disputed":
      return "disputed"
    default:
      return "draft"
  }
}

export function getCommissionPath(commissionId: number | null | undefined): string {
  return commissionId && commissionId > 0 ? `/commissions/${commissionId}` : "/commissions";
}

export function formatCommissionDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function getCommissionBungalowLabel(
  record: Pick<
    CommissionRecord,
    "bungalow_name" | "bungalow_chain" | "bungalow_token_address"
  >,
): string {
  return (
    record.bungalow_name ||
    `${record.bungalow_chain}:${record.bungalow_token_address}`
  );
}

export function findDirectoryBungalow(
  options: DirectoryBungalow[],
  chain: string,
  tokenAddress: string,
): DirectoryBungalow | null {
  return (
    options.find(
      (bungalow) =>
        bungalow.chain === chain &&
        bungalow.token_address.toLowerCase() === tokenAddress.toLowerCase(),
    ) ?? null
  );
}
