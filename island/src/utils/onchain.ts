import { erc20Abi, formatUnits, getAddress, type Address, type Hex } from "viem";
import bodegaAbiJson from "../../../contracts/current/abi/Bodega.json";
import commissionManagerAbiJson from "../../../contracts/current/abi/CommissionManager.json";
import islandIdentityAbiJson from "../../../contracts/current/abi/IslandIdentity.json";
import jungleBayIslandAbiJson from "../../../contracts/current/abi/JungleBayIsland.json";
import deploymentJson from "../../../contracts/current/deployments/base.json";

const deployment = deploymentJson as {
  chain: string;
  chainId: number;
  contracts: Record<string, { address: string }>;
  tokens: Record<string, string>;
};

export const islandIdentityAbi = islandIdentityAbiJson as readonly unknown[];
export const jungleBayIslandAbi = jungleBayIslandAbiJson as readonly unknown[];
export const bodegaAbi = bodegaAbiJson as readonly unknown[];
export const commissionManagerAbi = commissionManagerAbiJson as readonly unknown[];

function requireEnvAddress(name: string, expected: string): Address {
  const value = (import.meta.env[name] as string | undefined)?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in island/.env`);
  }

  const actual = getAddress(value);
  const canonical = getAddress(expected);
  if (actual !== canonical) {
    throw new Error(`${name} mismatch: env=${actual} deployment=${canonical}`);
  }
  return actual;
}

export const ONCHAIN_CONTRACTS = {
  chainId: deployment.chainId,
  chain: deployment.chain,
  islandIdentity: requireEnvAddress(
    "VITE_ISLAND_IDENTITY_CONTRACT_ADDRESS",
    deployment.contracts.IslandIdentity.address,
  ),
  jungleBayIsland: requireEnvAddress(
    "VITE_JUNGLE_BAY_ISLAND_CONTRACT_ADDRESS",
    deployment.contracts.JungleBayIsland.address,
  ),
  bodega: requireEnvAddress(
    "VITE_BODEGA_CONTRACT_ADDRESS",
    deployment.contracts.Bodega.address,
  ),
  commissionManager: requireEnvAddress(
    "VITE_COMMISSION_MANAGER_CONTRACT_ADDRESS",
    deployment.contracts.CommissionManager.address,
  ),
  usdc: requireEnvAddress("VITE_USDC_ADDRESS", deployment.tokens.USDC),
  jbm: requireEnvAddress("VITE_JBM_TOKEN_ADDRESS", deployment.tokens.JBM),
} as const;

export interface OnchainMeResponse {
  contracts: typeof ONCHAIN_CONTRACTS;
  session: {
    privy_user_id: string;
    x_user_id: string;
    x_handle: string;
    x_username: string | null;
    wallets: string[];
  };
  profile: {
    profile_id: number;
    x_user_id: string;
    x_handle: string;
    main_wallet: string;
    created_at_unix: number;
    updated_at_unix: number;
    hardcore_warning: boolean;
    wallets: string[];
  } | null;
  heat: {
    island_heat: number;
    tier: string;
    active_bond_heat: number;
  };
  next_action: string;
}

export interface OnchainBungalowPage {
  exists: boolean;
  bungalow_id: number | null;
  owner_wallet: string | null;
  name: string | null;
  ticker: string | null;
  ipfs_hash: string | null;
  minted_at_unix: number | null;
  seed_asset: {
    chain: string;
    token_address: string;
  } | null;
  assets: Array<{
    chain: string;
    token_address: string;
    added_at_unix: number;
    is_seed: boolean;
    label: string | null;
    symbol: string | null;
    image_url: string | null;
  }>;
  viewer: {
    wallet: string | null;
    profile_id: number | null;
    onchain_heat: number;
    backend_heat: number;
    can_sync_heat: boolean;
    owns_bungalow: boolean;
    bond_activated: boolean;
  };
  installs: Array<{
    item_id: number;
    creator_profile_id: number;
    creator_handle: string | null;
    ipfs_uri: string;
    price_usdc: string;
    supply: string;
    total_minted: string;
    active: boolean;
    listed_at_unix: number;
    commission_id: number | null;
    installed_by_profile_id: number;
    installed_at_unix: number;
  }>;
  commissions: Array<{
    commission_id: number;
    prompt_uri: string;
    budget_usdc: string;
    deadline_unix: number;
    status: string;
    selected_artist_profile_id: number | null;
    agreed_price_usdc: string | null;
    deliverable_uri: string | null;
    published_at_unix: number;
  }>;
}

export interface OnchainBodegaItem {
  item_id: number;
  creator_profile_id: number;
  creator_handle: string | null;
  ipfs_uri: string;
  supply: string;
  price_usdc: string;
  total_minted: string;
  active: boolean;
  listed_at_unix: number;
  commission_id: number | null;
}

export interface OnchainCommissionListItem {
  commission_id: number;
  requester_profile_id: number;
  requester_handle: string | null;
  bungalow_id: number;
  prompt_uri: string;
  budget_usdc: string;
  deadline_unix: number;
  published_at_unix: number;
  selected_artist_profile_id: number | null;
  agreed_price_usdc: string | null;
  deliverable_uri: string | null;
  status: string;
  bungalow_name: string | null;
  seed_chain: string | null;
  seed_token_address: string | null;
  requester_rejections: string;
  requester_warning: boolean;
  application_count: number;
}

export interface OnchainCommissionDetail {
  commission: Record<string, unknown>;
  applications: Array<Record<string, unknown>>;
  viewer: Record<string, unknown>;
}

export interface AppStateRecentTx {
  tx_hash: string;
  action: string;
  function_name: string | null;
  status: string;
  wallet: string | null;
  profile_id: number | null;
  bungalow_id: number | null;
  item_id: number | null;
  commission_id: number | null;
  application_id: number | null;
  block_number: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export interface AppClaimState {
  wallet: string | null;
  profile_id: number | null;
  period_id: string;
  amount: string | null;
  amount_jbm: string | null;
  active_bond_heat: number;
  already_claimed: boolean;
  can_claim: boolean;
  reason: string | null;
  next_claim_at_unix: number;
}

export interface AppMeState {
  authenticated: boolean;
  me: OnchainMeResponse | null;
  claim: AppClaimState | null;
  recent_txs: AppStateRecentTx[];
}

export interface StateHomeTeamBungalow {
  token_address: string;
  chain: string;
  canonical_slug?: string | null;
  name: string | null;
  symbol: string | null;
  holder_count: number;
  image_url: string | null;
  is_claimed: boolean | null;
  current_owner: string | null;
  description: string | null;
  market_cap: string | null;
  price_usd: string | null;
}

export interface AppIslandState {
  me: OnchainMeResponse | null;
  bungalows: StateHomeTeamBungalow[];
  stats: {
    bungalow_count: number;
    claimed_count: number;
  };
  updated_at_unix: number;
}

export interface AppBodegaArtistHighlight {
  artist_profile_id: number;
  artist_handle: string | null;
  score: number;
  rationale: string;
  metrics: {
    item_count: number;
    total_installs: number;
    distinct_bungalows: number;
    commissioned_items: number;
    approved_commissions: number;
    recent_items: number;
    recent_installs: number;
  };
  feature_item: {
    item_id: number;
    ipfs_uri: string;
    total_minted: string;
    price_usdc: string;
    commission_id: number | null;
    listed_at_unix: number;
  };
}

export interface AppBodegaState {
  me: OnchainMeResponse | null;
  items: OnchainBodegaItem[];
  highlighted_artists: AppBodegaArtistHighlight[];
  updated_at_unix: number;
}

export interface AppBungalowState {
  me: OnchainMeResponse | null;
  page: OnchainBungalowPage;
  heat_leaderboard: Array<{
    wallet: string;
    handle: string | null;
    heat_score: string;
    island_heat: string | null;
    avatar_url: string | null;
  }>;
  bond_holders: Array<{
    profile_id: number;
    handle: string | null;
    heat_score: string;
    main_wallet: string | null;
  }>;
  recent_txs: AppStateRecentTx[];
  stats: {
    asset_count: number;
    install_count: number;
    active_commission_count: number;
  };
}

export interface AppCommissionsState {
  me: OnchainMeResponse | null;
  items: OnchainCommissionListItem[];
  scope: string;
  viewer_profile_id: number | null;
}

export interface AppCommissionDetailState {
  me: OnchainMeResponse | null;
  commission: Record<string, unknown>;
  applications: Array<Record<string, unknown>>;
  viewer: Record<string, unknown>;
}

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

export async function fetchAuthedJson<T>(
  input: RequestInfo,
  getAccessToken: () => Promise<string | null>,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetchJson<T>(input, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
}

export async function ensureUsdcAllowance(input: {
  publicClient: any;
  walletClient: any;
  owner: Address;
  spender: Address;
  amount: bigint;
}): Promise<Hex | null> {
  if (input.amount <= 0n) return null;

  const allowance = await input.publicClient.readContract({
    address: ONCHAIN_CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [input.owner, input.spender],
  });

  if (allowance >= input.amount) {
    return null;
  }

  return await input.walletClient.writeContract({
    address: ONCHAIN_CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.spender, input.amount],
    account: input.owner,
    chain: null,
  });
}

export async function trackSubmittedTx(input: {
  getAccessToken: () => Promise<string | null>;
  txHash: string;
  action: string;
  functionName: string;
  contractAddress: Address;
  wallet: string;
  profileId?: number | null;
  bungalowId?: number | null;
  itemId?: number | null;
  commissionId?: number | null;
  applicationId?: number | null;
  tokenAddress?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await fetchAuthedJson(
    "/api/onchain/txs",
    input.getAccessToken,
    {
      method: "POST",
      body: JSON.stringify({
        tx_hash: input.txHash,
        action: input.action,
        function_name: input.functionName,
        contract_address: input.contractAddress,
        wallet: input.wallet,
        profile_id: input.profileId ?? null,
        bungalow_id: input.bungalowId ?? null,
        item_id: input.itemId ?? null,
        commission_id: input.commissionId ?? null,
        application_id: input.applicationId ?? null,
        token_address: input.tokenAddress ?? null,
        metadata: input.metadata ?? null,
      }),
    },
  );
}

export async function confirmTrackedTx(
  getAccessToken: () => Promise<string | null>,
  txHash: string,
) {
  return await fetchAuthedJson<{
    status: string;
    receipt: { blockNumber?: string } | null;
    derived: Record<string, unknown> | null;
  }>(
    `/api/onchain/txs/${encodeURIComponent(txHash)}/confirm`,
    getAccessToken,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function parseUsdcRaw(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? BigInt(trimmed) : 0n;
  }
  return 0n;
}

export function formatUsdcAmount(value: string | bigint | number | null | undefined): string {
  const raw = parseUsdcRaw(value);
  return formatUnits(raw, 6);
}

export function formatUnixDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}

export function normalizeTxError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const text = error.message.trim();
  if (!text) return fallback;
  if (/user rejected/i.test(text)) {
    return "Transaction rejected in wallet.";
  }
  return text;
}
