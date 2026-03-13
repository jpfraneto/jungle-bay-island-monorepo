import { randomBytes } from "node:crypto";
import {
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseUnits,
  stringify,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import bodegaAbiJson from "../../../contracts/current/abi/Bodega.json";
import commissionManagerAbiJson from "../../../contracts/current/abi/CommissionManager.json";
import islandIdentityAbiJson from "../../../contracts/current/abi/IslandIdentity.json";
import jungleBayIslandAbiJson from "../../../contracts/current/abi/JungleBayIsland.json";
import deploymentJson from "../../../contracts/current/deployments/base.json";
import { CONFIG, db, normalizeAddress, publicClients } from "../config";
import type { IdentityCluster } from "../db/queries";
import {
  getAggregatedUserByWallets,
  getIdentityClusterByWallet,
  getTokenRegistry,
  getUserByPrivyUserId,
  getUserWallets,
  upsertUser,
  upsertUserWalletLinks,
} from "../db/queries";
import { fetchDexScreenerData } from "./dexscreener";
import { ApiError } from "./errors";
import { updateOnchainInteraction } from "./interactionLedger";
import { extractPrivyXUsername, getPrivyLinkedAccounts } from "./privyClaims";
import { resolveTokenMetadata } from "./tokenMetadata";

const islandIdentityAbi = islandIdentityAbiJson as readonly unknown[];
const jungleBayIslandAbi = jungleBayIslandAbiJson as readonly unknown[];
const bodegaAbi = bodegaAbiJson as readonly unknown[];
const commissionManagerAbi = commissionManagerAbiJson as readonly unknown[];
const deployment = deploymentJson as {
  chain: string;
  chainId: number;
  deploymentBlock?: number;
  contracts: Record<string, { address: string; abi: string }>;
  tokens: Record<string, string>;
  roles: Record<string, string>;
};

export type OnchainContractName =
  | "IslandIdentity"
  | "JungleBayIsland"
  | "Bodega"
  | "CommissionManager";

export type OnchainInteractionStatus =
  | "submitted"
  | "confirmed"
  | "indexed"
  | "failed";

export type CommissionStatus =
  | "OPEN"
  | "SELECTED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "TIMED_OUT"
  | "DEADLINE_MISSED";

export interface OnchainContractsConfig {
  chainId: number;
  chain: string;
  islandIdentity: Address;
  jungleBayIsland: Address;
  bodega: Address;
  commissionManager: Address;
  usdc: Address;
  jbm: Address;
  backendSigner: Address;
}

export interface SessionIdentity {
  privyUserId: string;
  xUserId: bigint;
  xHandle: string;
  authorizedWallets: string[];
  profileId: number | null;
  profile: OnchainProfileRow | null;
  walletCluster: IdentityCluster | null;
  aggregatedHeat: number;
  tier: string;
}

export interface OnchainProfileRow {
  profile_id: number;
  x_user_id: string;
  x_handle: string;
  main_wallet: string;
  created_at_unix: number;
  updated_at_unix: number;
  hardcore_warning: boolean;
  wallets: string[];
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
    status: CommissionStatus;
    selected_artist_profile_id: number | null;
    agreed_price_usdc: string | null;
    deliverable_uri: string | null;
    published_at_unix: number;
  }>;
}

const COMMISSION_STATUS_BY_CODE: Record<number, CommissionStatus> = {
  0: "OPEN",
  1: "SELECTED",
  2: "SUBMITTED",
  3: "APPROVED",
  4: "REJECTED",
  5: "EXPIRED",
  6: "TIMED_OUT",
  7: "DEADLINE_MISSED",
};

const CONTRACT_EVENT_TABLE = "onchain_contract_events";
const CONTRACT_CURSOR_TABLE = "onchain_event_cursors";
const PROFILE_TABLE = "onchain_profiles";
const PROFILE_WALLET_TABLE = "onchain_profile_wallets";
const PROFILE_HEAT_TABLE = "onchain_profile_bungalow_heat";
const BUNGALOW_TABLE = "onchain_bungalows";
const BUNGALOW_ASSET_TABLE = "onchain_bungalow_assets";
const ITEM_TABLE = "onchain_bodega_items";
const INSTALL_TABLE = "onchain_bungalow_installs";
const COMMISSION_TABLE = "onchain_commissions";
const APPLICATION_TABLE = "onchain_commission_applications";
const DAILY_CLAIM_TABLE = "onchain_daily_claims";

function requiredAddress(name: string, value: string, expected?: string): Address {
  if (!value.trim()) {
    throw new Error(`Missing required contract config: ${name}`);
  }

  const normalized = getAddress(value);
  if (expected && normalized !== getAddress(expected)) {
    throw new Error(
      `Contract config mismatch for ${name}: env=${normalized} deployment=${getAddress(expected)}`,
    );
  }
  return normalized;
}

export const ONCHAIN_CONTRACTS: OnchainContractsConfig = {
  chainId: deployment.chainId,
  chain: deployment.chain,
  islandIdentity: requiredAddress(
    "ISLAND_IDENTITY_CONTRACT_ADDRESS",
    CONFIG.ISLAND_IDENTITY_CONTRACT_ADDRESS,
    deployment.contracts.IslandIdentity.address,
  ),
  jungleBayIsland: requiredAddress(
    "JUNGLE_BAY_ISLAND_CONTRACT_ADDRESS",
    CONFIG.JUNGLE_BAY_ISLAND_CONTRACT_ADDRESS,
    deployment.contracts.JungleBayIsland.address,
  ),
  bodega: requiredAddress(
    "BODEGA_CONTRACT_ADDRESS",
    CONFIG.BODEGA_CONTRACT_ADDRESS,
    deployment.contracts.Bodega.address,
  ),
  commissionManager: requiredAddress(
    "COMMISSION_MANAGER_CONTRACT_ADDRESS",
    CONFIG.COMMISSION_MANAGER_CONTRACT_ADDRESS,
    deployment.contracts.CommissionManager.address,
  ),
  usdc: requiredAddress("USDC_ADDRESS", CONFIG.USDC_ADDRESS, deployment.tokens.USDC),
  jbm: requiredAddress("JBM_TOKEN_ADDRESS", CONFIG.JBM_TOKEN_ADDRESS, deployment.tokens.JBM),
  backendSigner: getAddress(deployment.roles.backendSigner),
};

export function getInitialBackfillStartBlock(): bigint {
  if (typeof deployment.deploymentBlock === "number" && deployment.deploymentBlock > 0) {
    return BigInt(deployment.deploymentBlock);
  }
  return 0n;
}

const backendSignerAccount = (() => {
  const privateKey = CONFIG.BACKEND_SIGNER_PRIVATE_KEY.trim() as Hex;
  if (!privateKey) {
    throw new Error("Missing required env var: BACKEND_SIGNER_PRIVATE_KEY");
  }
  const account = privateKeyToAccount(privateKey);
  if (account.address !== ONCHAIN_CONTRACTS.backendSigner) {
    throw new Error(
      `BACKEND_SIGNER_PRIVATE_KEY address mismatch: env=${account.address} deployment=${ONCHAIN_CONTRACTS.backendSigner}`,
    );
  }
  return account;
})();

const CONTRACT_ADDRESS_TO_NAME = new Map<string, OnchainContractName>([
  [ONCHAIN_CONTRACTS.islandIdentity.toLowerCase(), "IslandIdentity"],
  [ONCHAIN_CONTRACTS.jungleBayIsland.toLowerCase(), "JungleBayIsland"],
  [ONCHAIN_CONTRACTS.bodega.toLowerCase(), "Bodega"],
  [ONCHAIN_CONTRACTS.commissionManager.toLowerCase(), "CommissionManager"],
]);

const CONTRACT_ABI_BY_NAME: Record<OnchainContractName, readonly unknown[]> = {
  IslandIdentity: islandIdentityAbi,
  JungleBayIsland: jungleBayIslandAbi,
  Bodega: bodegaAbi,
  CommissionManager: commissionManagerAbi,
};

const publicClient = publicClients.base;
let onchainSchemaPromise: Promise<void> | null = null;

function normalizeLower(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeAssetChain(value: string): string {
  return normalizeLower(value);
}

export function isCaseInsensitiveChain(chain: string): boolean {
  return new Set([
    "ethereum",
    "base",
    "optimism",
    "arbitrum",
    "polygon",
    "bsc",
    "avalanche",
    "fantom",
    "zora",
    "linea",
    "blast",
    "scroll",
    "mode",
    "ink",
    "mantle",
    "sei",
    "worldchain",
    "berachain",
  ]).has(normalizeAssetChain(chain));
}

export function canonicalizeAssetIdentifier(chain: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, "invalid_asset", "Asset identifier is required");
  }

  if (isCaseInsensitiveChain(chain)) {
    const normalized = normalizeAddress(trimmed) ?? trimmed.toLowerCase();
    return normalized;
  }

  return trimmed;
}

export function canonicalizeAssetRef(input: { chain: string; tokenAddress: string }) {
  const chain = normalizeAssetChain(input.chain);
  const tokenAddress = canonicalizeAssetIdentifier(chain, input.tokenAddress);
  return {
    chain,
    tokenAddress,
  };
}

export function computeAssetKey(input: { chain: string; tokenAddress: string }): Hex {
  const asset = canonicalizeAssetRef(input);
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [keccak256(new TextEncoder().encode(asset.chain)), keccak256(new TextEncoder().encode(asset.tokenAddress))],
    ),
  );
}

function bigintToNumber(value: bigint): number {
  return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
}

function safeNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toJson(value: unknown): string {
  return stringify(value, (_, inner) => {
    if (typeof inner === "bigint") {
      return inner.toString();
    }
    return inner;
  });
}

function randomSalt(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

function signatureDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
}

function currentDailyPeriodId(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / 86_400));
}

function getXUserIdFromClaims(claims: Record<string, unknown> | undefined): bigint | null {
  if (!claims) return null;

  const linkedAccounts = getPrivyLinkedAccounts(claims);
  for (const account of linkedAccounts) {
    const type = typeof account.type === "string" ? account.type : "";
    if (type !== "twitter" && type !== "twitter_oauth") continue;

    const candidates = [
      account.subject,
      account.user_id,
      account.userId,
      account.twitter_user_id,
      account.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return BigInt(Math.trunc(candidate));
      }
      if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
        return BigInt(candidate.trim());
      }
    }
  }

  return null;
}

async function ensureOnchainSchema(): Promise<void> {
  if (!onchainSchemaPromise) {
    onchainSchemaPromise = (async () => {
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${CONTRACT_EVENT_TABLE} (
          chain_id INTEGER NOT NULL,
          block_number BIGINT NOT NULL,
          transaction_hash TEXT NOT NULL,
          transaction_index INTEGER NOT NULL,
          log_index INTEGER NOT NULL,
          contract_address TEXT NOT NULL,
          contract_name TEXT NOT NULL,
          event_name TEXT NOT NULL,
          event_args JSONB NOT NULL,
          indexing_status TEXT NOT NULL DEFAULT 'pending',
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ,
          PRIMARY KEY (chain_id, transaction_hash, log_index)
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${CONTRACT_CURSOR_TABLE} (
          chain_id INTEGER NOT NULL,
          contract_name TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          next_from_block BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (chain_id, contract_name, contract_address)
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${PROFILE_TABLE} (
          profile_id BIGINT PRIMARY KEY,
          x_user_id NUMERIC NOT NULL,
          x_handle TEXT NOT NULL,
          main_wallet TEXT NOT NULL,
          created_at_unix BIGINT NOT NULL,
          updated_at_unix BIGINT NOT NULL,
          hardcore_warning BOOLEAN NOT NULL DEFAULT FALSE,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${PROFILE_WALLET_TABLE} (
          profile_id BIGINT NOT NULL,
          wallet TEXT NOT NULL,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (profile_id, wallet)
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${PROFILE_HEAT_TABLE} (
          profile_id BIGINT NOT NULL,
          bungalow_id BIGINT NOT NULL,
          heat_score NUMERIC NOT NULL DEFAULT 0,
          bond_activated BOOLEAN NOT NULL DEFAULT FALSE,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (profile_id, bungalow_id)
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${BUNGALOW_TABLE} (
          bungalow_id BIGINT PRIMARY KEY,
          owner_wallet TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          ticker TEXT NOT NULL DEFAULT '',
          ipfs_hash TEXT NOT NULL DEFAULT '',
          minted_at_unix BIGINT NOT NULL,
          seed_asset_key TEXT NOT NULL,
          seed_chain TEXT NOT NULL,
          seed_token_address TEXT NOT NULL,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${BUNGALOW_ASSET_TABLE} (
          asset_key TEXT PRIMARY KEY,
          bungalow_id BIGINT NOT NULL,
          chain TEXT NOT NULL,
          token_address TEXT NOT NULL,
          added_at_unix BIGINT NOT NULL,
          is_seed BOOLEAN NOT NULL DEFAULT FALSE,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${ITEM_TABLE} (
          item_id BIGINT PRIMARY KEY,
          creator_profile_id BIGINT NOT NULL,
          ipfs_uri TEXT NOT NULL,
          supply NUMERIC NOT NULL,
          price_usdc NUMERIC NOT NULL,
          total_minted NUMERIC NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          listed_at_unix BIGINT NOT NULL,
          commission_id BIGINT,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${INSTALL_TABLE} (
          bungalow_id BIGINT NOT NULL,
          item_id BIGINT NOT NULL,
          installer_profile_id BIGINT NOT NULL,
          price_usdc NUMERIC NOT NULL DEFAULT 0,
          tx_hash TEXT NOT NULL,
          installed_at_unix BIGINT NOT NULL,
          PRIMARY KEY (bungalow_id, item_id)
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${COMMISSION_TABLE} (
          commission_id BIGINT PRIMARY KEY,
          requester_profile_id BIGINT NOT NULL,
          bungalow_id BIGINT NOT NULL,
          prompt_uri TEXT NOT NULL,
          budget_usdc NUMERIC NOT NULL,
          deadline_unix BIGINT NOT NULL,
          published_at_unix BIGINT NOT NULL,
          selected_at_unix BIGINT,
          submitted_at_unix BIGINT,
          selected_artist_profile_id BIGINT,
          agreed_price_usdc NUMERIC,
          deliverable_uri TEXT,
          status TEXT NOT NULL,
          item_id BIGINT,
          artist_reputation NUMERIC NOT NULL DEFAULT 0,
          artist_warning BOOLEAN NOT NULL DEFAULT FALSE,
          requester_rejections NUMERIC NOT NULL DEFAULT 0,
          requester_warning BOOLEAN NOT NULL DEFAULT FALSE,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${APPLICATION_TABLE} (
          application_id BIGINT PRIMARY KEY,
          commission_id BIGINT NOT NULL,
          artist_profile_id BIGINT NOT NULL,
          pitch_uri TEXT NOT NULL,
          proposed_price_usdc NUMERIC NOT NULL,
          applied_at_unix BIGINT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.unsafe(`
        CREATE TABLE IF NOT EXISTS "${CONFIG.SCHEMA}".${DAILY_CLAIM_TABLE} (
          wallet TEXT NOT NULL,
          period_id BIGINT NOT NULL,
          profile_id BIGINT NOT NULL,
          amount NUMERIC NOT NULL,
          tx_hash TEXT NOT NULL,
          claimed_at_unix BIGINT NOT NULL,
          PRIMARY KEY (wallet, period_id)
        )
      `);
      await db.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_onchain_bungalow_assets_bungalow
        ON "${CONFIG.SCHEMA}".${BUNGALOW_ASSET_TABLE} (bungalow_id, added_at_unix ASC)
      `);
      await db.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_onchain_install_lookup
        ON "${CONFIG.SCHEMA}".${INSTALL_TABLE} (bungalow_id, installed_at_unix DESC)
      `);
      await db.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_onchain_commission_lookup
        ON "${CONFIG.SCHEMA}".${COMMISSION_TABLE} (status, published_at_unix DESC)
      `);
      await db.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_onchain_application_lookup
        ON "${CONFIG.SCHEMA}".${APPLICATION_TABLE} (commission_id, applied_at_unix ASC)
      `);
    })();
  }

  await onchainSchemaPromise;
}

export async function syncSessionWallets(input: {
  privyUserId: string;
  claims: Record<string, unknown> | undefined;
}): Promise<string[]> {
  const username = input.claims ? extractPrivyXUsername(input.claims) : null;
  await upsertUser(input.privyUserId, {
    x_username: username ?? undefined,
  });

  const linkedAccounts = getPrivyLinkedAccounts(input.claims ?? {});
  const claimWallets = linkedAccounts
    .map((account) => (typeof account.address === "string" ? account.address : ""))
    .map((wallet) => normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana"))
    .filter((wallet): wallet is string => Boolean(wallet));

  for (const wallet of claimWallets) {
    await upsertUserWalletLinks(
      input.privyUserId,
      wallet,
      normalizeAddress(wallet) ? "privy_siwe" : "privy_siws",
    );
  }

  const storedWallets = await getUserWallets(input.privyUserId);
  return [...new Set([...claimWallets, ...storedWallets.map((row) => row.address)])];
}

async function readIdentityBackendSigner(): Promise<Address> {
  return await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.islandIdentity,
    abi: islandIdentityAbi,
    functionName: "backendSigner",
  }) as Address;
}

async function readIslandBackendSigner(): Promise<Address> {
  return await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.jungleBayIsland,
    abi: jungleBayIslandAbi,
    functionName: "backendSigner",
  }) as Address;
}

export async function assertBackendSignerAlignment(): Promise<void> {
  const [identitySigner, islandSigner] = await Promise.all([
    readIdentityBackendSigner(),
    readIslandBackendSigner(),
  ]);

  if (
    getAddress(identitySigner) !== backendSignerAccount.address ||
    getAddress(islandSigner) !== backendSignerAccount.address
  ) {
    throw new Error(
      `Onchain backend signer mismatch: IslandIdentity=${identitySigner}, JungleBayIsland=${islandSigner}, env=${backendSignerAccount.address}`,
    );
  }
}

async function syncProfileById(profileId: number): Promise<OnchainProfileRow> {
  await ensureOnchainSchema();
  const profile = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.islandIdentity,
    abi: islandIdentityAbi,
    functionName: "getProfile",
    args: [BigInt(profileId)],
  }) as readonly [bigint, string, Address, Address[], bigint, boolean];

  const [xUserId, xHandle, mainWallet, wallets, createdAt, hardcoreWarning] = profile;
  const updatedAt = Math.floor(Date.now() / 1000);

  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${PROFILE_TABLE} (
        profile_id,
        x_user_id,
        x_handle,
        main_wallet,
        created_at_unix,
        updated_at_unix,
        hardcore_warning,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (profile_id)
      DO UPDATE SET
        x_user_id = EXCLUDED.x_user_id,
        x_handle = EXCLUDED.x_handle,
        main_wallet = EXCLUDED.main_wallet,
        created_at_unix = EXCLUDED.created_at_unix,
        updated_at_unix = EXCLUDED.updated_at_unix,
        hardcore_warning = EXCLUDED.hardcore_warning,
        last_synced_at = NOW()
    `,
    [
      profileId,
      xUserId.toString(),
      xHandle,
      mainWallet,
      bigintToNumber(createdAt),
      updatedAt,
      hardcoreWarning,
    ],
  );

  await db.unsafe(
    `DELETE FROM "${CONFIG.SCHEMA}".${PROFILE_WALLET_TABLE} WHERE profile_id = $1`,
    [profileId],
  );
  for (const wallet of wallets) {
    await db.unsafe(
      `
        INSERT INTO "${CONFIG.SCHEMA}".${PROFILE_WALLET_TABLE} (
          profile_id,
          wallet,
          last_synced_at
        )
        VALUES ($1,$2,NOW())
        ON CONFLICT (profile_id, wallet)
        DO UPDATE SET last_synced_at = NOW()
      `,
      [profileId, wallet],
    );
  }

  return {
    profile_id: profileId,
    x_user_id: xUserId.toString(),
    x_handle: xHandle,
    main_wallet: mainWallet,
    created_at_unix: bigintToNumber(createdAt),
    updated_at_unix: updatedAt,
    hardcore_warning: hardcoreWarning,
    wallets: wallets.map((wallet) => wallet.toLowerCase()),
  };
}

async function syncHeatState(profileId: number, bungalowId: number): Promise<void> {
  await ensureOnchainSchema();
  const [heatScore, bondActivated] = await Promise.all([
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      functionName: "getHeat",
      args: [BigInt(profileId), BigInt(bungalowId)],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      functionName: "hasBond",
      args: [BigInt(profileId), BigInt(bungalowId)],
    }) as Promise<boolean>,
  ]);

  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${PROFILE_HEAT_TABLE} (
        profile_id,
        bungalow_id,
        heat_score,
        bond_activated,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (profile_id, bungalow_id)
      DO UPDATE SET
        heat_score = EXCLUDED.heat_score,
        bond_activated = EXCLUDED.bond_activated,
        last_synced_at = NOW()
    `,
    [profileId, bungalowId, heatScore.toString(), bondActivated],
  );
}

async function syncBungalowById(bungalowId: number): Promise<void> {
  await ensureOnchainSchema();
  const [bungalow, ownerWallet, assets] = await Promise.all([
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      functionName: "bungalows",
      args: [BigInt(bungalowId)],
    }) as Promise<readonly [bigint, string, string, string, bigint, Hex]>,
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      functionName: "ownerOf",
      args: [BigInt(bungalowId)],
    }) as Promise<Address>,
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      functionName: "getBungalowAssets",
      args: [BigInt(bungalowId)],
    }) as Promise<Array<{ chain: string; tokenAddress: string; addedAt: bigint }>>,
  ]);

  const [, name, ticker, ipfsHash, mintedAt, seedAssetKey] = bungalow;
  let seedChain = "";
  let seedTokenAddress = "";
  const rows = assets.map((asset) => {
    const normalized = canonicalizeAssetRef({
      chain: asset.chain,
      tokenAddress: asset.tokenAddress,
    });
    const assetKey = computeAssetKey({
      chain: normalized.chain,
      tokenAddress: normalized.tokenAddress,
    });
    const isSeed = assetKey.toLowerCase() === seedAssetKey.toLowerCase();
    if (isSeed) {
      seedChain = normalized.chain;
      seedTokenAddress = normalized.tokenAddress;
    }
    return {
      assetKey,
      chain: normalized.chain,
      tokenAddress: normalized.tokenAddress,
      addedAt: bigintToNumber(asset.addedAt),
      isSeed,
    };
  });

  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${BUNGALOW_TABLE} (
        bungalow_id,
        owner_wallet,
        name,
        ticker,
        ipfs_hash,
        minted_at_unix,
        seed_asset_key,
        seed_chain,
        seed_token_address,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (bungalow_id)
      DO UPDATE SET
        owner_wallet = EXCLUDED.owner_wallet,
        name = EXCLUDED.name,
        ticker = EXCLUDED.ticker,
        ipfs_hash = EXCLUDED.ipfs_hash,
        minted_at_unix = EXCLUDED.minted_at_unix,
        seed_asset_key = EXCLUDED.seed_asset_key,
        seed_chain = EXCLUDED.seed_chain,
        seed_token_address = EXCLUDED.seed_token_address,
        last_synced_at = NOW()
    `,
    [
      bungalowId,
      ownerWallet,
      name,
      ticker,
      ipfsHash,
      bigintToNumber(mintedAt),
      seedAssetKey,
      seedChain,
      seedTokenAddress,
    ],
  );

  await db.unsafe(
    `DELETE FROM "${CONFIG.SCHEMA}".${BUNGALOW_ASSET_TABLE} WHERE bungalow_id = $1`,
    [bungalowId],
  );

  for (const row of rows) {
    await db.unsafe(
      `
        INSERT INTO "${CONFIG.SCHEMA}".${BUNGALOW_ASSET_TABLE} (
          asset_key,
          bungalow_id,
          chain,
          token_address,
          added_at_unix,
          is_seed,
          last_synced_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (asset_key)
        DO UPDATE SET
          bungalow_id = EXCLUDED.bungalow_id,
          chain = EXCLUDED.chain,
          token_address = EXCLUDED.token_address,
          added_at_unix = EXCLUDED.added_at_unix,
          is_seed = EXCLUDED.is_seed,
          last_synced_at = NOW()
      `,
      [
        row.assetKey,
        bungalowId,
        row.chain,
        row.tokenAddress,
        row.addedAt,
        row.isSeed,
      ],
    );
  }
}

async function syncItemById(itemId: number, commissionId?: number | null): Promise<void> {
  await ensureOnchainSchema();
  const item = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.bodega,
    abi: bodegaAbi,
    functionName: "getItem",
    args: [BigInt(itemId)],
  }) as readonly [bigint, bigint, string, bigint, bigint, bigint, boolean, bigint];

  const [, creatorProfileId, ipfsUri, supply, priceUsdc, totalMinted, active, listedAt] = item;
  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${ITEM_TABLE} (
        item_id,
        creator_profile_id,
        ipfs_uri,
        supply,
        price_usdc,
        total_minted,
        active,
        listed_at_unix,
        commission_id,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (item_id)
      DO UPDATE SET
        creator_profile_id = EXCLUDED.creator_profile_id,
        ipfs_uri = EXCLUDED.ipfs_uri,
        supply = EXCLUDED.supply,
        price_usdc = EXCLUDED.price_usdc,
        total_minted = EXCLUDED.total_minted,
        active = EXCLUDED.active,
        listed_at_unix = EXCLUDED.listed_at_unix,
        commission_id = COALESCE(EXCLUDED.commission_id, "${CONFIG.SCHEMA}".${ITEM_TABLE}.commission_id),
        last_synced_at = NOW()
    `,
    [
      itemId,
      bigintToNumber(creatorProfileId),
      ipfsUri,
      supply.toString(),
      priceUsdc.toString(),
      totalMinted.toString(),
      active,
      bigintToNumber(listedAt),
      commissionId ?? null,
    ],
  );
}

async function syncCommissionApplicationById(applicationId: number): Promise<void> {
  await ensureOnchainSchema();
  const application = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.commissionManager,
    abi: commissionManagerAbi,
    functionName: "applications",
    args: [BigInt(applicationId)],
  }) as readonly [bigint, bigint, bigint, string, bigint, bigint, boolean];

  const [, commissionId, artistProfileId, pitchUri, proposedPrice, appliedAt, active] = application;
  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${APPLICATION_TABLE} (
        application_id,
        commission_id,
        artist_profile_id,
        pitch_uri,
        proposed_price_usdc,
        applied_at_unix,
        active,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (application_id)
      DO UPDATE SET
        commission_id = EXCLUDED.commission_id,
        artist_profile_id = EXCLUDED.artist_profile_id,
        pitch_uri = EXCLUDED.pitch_uri,
        proposed_price_usdc = EXCLUDED.proposed_price_usdc,
        applied_at_unix = EXCLUDED.applied_at_unix,
        active = EXCLUDED.active,
        last_synced_at = NOW()
    `,
    [
      applicationId,
      bigintToNumber(commissionId),
      bigintToNumber(artistProfileId),
      pitchUri,
      proposedPrice.toString(),
      bigintToNumber(appliedAt),
      active,
    ],
  );
}

async function syncCommissionById(commissionId: number, itemId?: number | null): Promise<void> {
  await ensureOnchainSchema();
  const commission = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.commissionManager,
    abi: commissionManagerAbi,
    functionName: "commissions",
    args: [BigInt(commissionId)],
  }) as readonly [
    bigint,
    bigint,
    bigint,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    string,
    number,
  ];

  const [
    ,
    requesterProfileId,
    bungalowId,
    promptUri,
    budget,
    deadline,
    publishedAt,
    selectedAt,
    submittedAt,
    selectedArtistProfileId,
    deliverableUri,
    statusCode,
  ] = commission;

  const [requesterProfile, artistProfile] = await Promise.all([
    publicClient.readContract({
      address: ONCHAIN_CONTRACTS.commissionManager,
      abi: commissionManagerAbi,
      functionName: "getRequesterProfile",
      args: [requesterProfileId],
    }) as Promise<readonly [bigint, boolean]>,
    selectedArtistProfileId > 0n
      ? publicClient.readContract({
          address: ONCHAIN_CONTRACTS.commissionManager,
          abi: commissionManagerAbi,
          functionName: "getArtistProfile",
          args: [selectedArtistProfileId],
        }) as Promise<readonly [bigint, boolean]>
      : Promise.resolve([0n, false] as const),
  ]);

  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${COMMISSION_TABLE} (
        commission_id,
        requester_profile_id,
        bungalow_id,
        prompt_uri,
        budget_usdc,
        deadline_unix,
        published_at_unix,
        selected_at_unix,
        submitted_at_unix,
        selected_artist_profile_id,
        agreed_price_usdc,
        deliverable_uri,
        status,
        item_id,
        artist_reputation,
        artist_warning,
        requester_rejections,
        requester_warning,
        last_synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT (commission_id)
      DO UPDATE SET
        requester_profile_id = EXCLUDED.requester_profile_id,
        bungalow_id = EXCLUDED.bungalow_id,
        prompt_uri = EXCLUDED.prompt_uri,
        budget_usdc = EXCLUDED.budget_usdc,
        deadline_unix = EXCLUDED.deadline_unix,
        published_at_unix = EXCLUDED.published_at_unix,
        selected_at_unix = EXCLUDED.selected_at_unix,
        submitted_at_unix = EXCLUDED.submitted_at_unix,
        selected_artist_profile_id = EXCLUDED.selected_artist_profile_id,
        agreed_price_usdc = EXCLUDED.agreed_price_usdc,
        deliverable_uri = EXCLUDED.deliverable_uri,
        status = EXCLUDED.status,
        item_id = COALESCE(EXCLUDED.item_id, "${CONFIG.SCHEMA}".${COMMISSION_TABLE}.item_id),
        artist_reputation = EXCLUDED.artist_reputation,
        artist_warning = EXCLUDED.artist_warning,
        requester_rejections = EXCLUDED.requester_rejections,
        requester_warning = EXCLUDED.requester_warning,
        last_synced_at = NOW()
    `,
    [
      commissionId,
      bigintToNumber(requesterProfileId),
      bigintToNumber(bungalowId),
      promptUri,
      budget.toString(),
      bigintToNumber(deadline),
      bigintToNumber(publishedAt),
      selectedAt > 0n ? bigintToNumber(selectedAt) : null,
      submittedAt > 0n ? bigintToNumber(submittedAt) : null,
      selectedArtistProfileId > 0n ? bigintToNumber(selectedArtistProfileId) : null,
      null,
      deliverableUri || null,
      COMMISSION_STATUS_BY_CODE[statusCode] ?? "OPEN",
      itemId ?? null,
      artistProfile[0].toString(),
      artistProfile[1],
      requesterProfile[0].toString(),
      requesterProfile[1],
    ],
  );

  const applicationIds = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.commissionManager,
    abi: commissionManagerAbi,
    functionName: "getCommissionApplications",
    args: [BigInt(commissionId)],
  }) as bigint[];

  for (const applicationId of applicationIds) {
    await syncCommissionApplicationById(bigintToNumber(applicationId));
  }
}

async function syncBungalowByAsset(input: { chain: string; tokenAddress: string }): Promise<number | null> {
  const asset = canonicalizeAssetRef(input);
  const page = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.jungleBayIsland,
    abi: jungleBayIslandAbi,
    functionName: "getBungalowPage",
    args: [asset.chain, asset.tokenAddress],
  }) as readonly [boolean, bigint, Address, string, string, string, bigint, string, string, bigint];

  const [exists, bungalowId] = page;
  if (!exists || bungalowId <= 0n) {
    return null;
  }

  await syncBungalowById(bigintToNumber(bungalowId));
  return bigintToNumber(bungalowId);
}

async function resolveProfileIdByWallet(wallet: string): Promise<number | null> {
  const normalized = normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana");
  if (!normalized || !normalizeAddress(normalized)) {
    return null;
  }

  const profileId = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.islandIdentity,
    abi: islandIdentityAbi,
    functionName: "walletProfileId",
    args: [normalized as Address],
  }) as bigint;

  if (profileId <= 0n) return null;
  return bigintToNumber(profileId);
}

async function loadStoredProfile(profileId: number): Promise<OnchainProfileRow | null> {
  await ensureOnchainSchema();
  const rows = await db<Array<{
    profile_id: number;
    x_user_id: string;
    x_handle: string;
    main_wallet: string;
    created_at_unix: number;
    updated_at_unix: number;
    hardcore_warning: boolean;
    wallets: string[];
  }>>`
    SELECT
      p.profile_id::int AS profile_id,
      p.x_user_id::text AS x_user_id,
      p.x_handle,
      p.main_wallet,
      p.created_at_unix::int AS created_at_unix,
      p.updated_at_unix::int AS updated_at_unix,
      p.hardcore_warning,
      COALESCE(
        (
          SELECT array_agg(w.wallet ORDER BY w.wallet)
          FROM ${db(CONFIG.SCHEMA)}.${db(PROFILE_WALLET_TABLE)} w
          WHERE w.profile_id = p.profile_id
        ),
        ARRAY[]::text[]
      ) AS wallets
    FROM ${db(CONFIG.SCHEMA)}.${db(PROFILE_TABLE)} p
    WHERE p.profile_id = ${profileId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function findProfileForWallets(wallets: string[]): Promise<OnchainProfileRow | null> {
  await ensureOnchainSchema();
  for (const wallet of wallets) {
    const normalized = normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana");
    if (!normalized) continue;

    const rows = await db<Array<{ profile_id: number }>>`
      SELECT profile_id::int AS profile_id
      FROM ${db(CONFIG.SCHEMA)}.${db(PROFILE_WALLET_TABLE)}
      WHERE LOWER(wallet) = LOWER(${normalized})
      LIMIT 1
    `;

    if (rows[0]?.profile_id) {
      return await loadStoredProfile(rows[0].profile_id);
    }

    const onchainProfileId = await resolveProfileIdByWallet(normalized);
    if (onchainProfileId) {
      await syncProfileById(onchainProfileId);
      return await loadStoredProfile(onchainProfileId);
    }
  }

  return null;
}

function requireSessionWallet(wallet: string | null | undefined, session: SessionIdentity): string {
  const normalized = wallet
    ? normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana")
    : null;

  if (!normalized) {
    throw new ApiError(400, "invalid_wallet", "A valid wallet is required");
  }

  if (!session.authorizedWallets.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    throw new ApiError(401, "wallet_not_owned", "wallet_not_owned");
  }

  return normalized;
}

export async function resolveSessionIdentity(input: {
  privyUserId: string;
  claims: Record<string, unknown> | undefined;
}): Promise<SessionIdentity> {
  const xUserId = getXUserIdFromClaims(input.claims);
  const xHandle = input.claims ? extractPrivyXUsername(input.claims) : null;
  if (!xUserId || !xHandle) {
    throw new ApiError(403, "x_account_required", "Sign in with X to use onchain identity");
  }

  const authorizedWallets = await syncSessionWallets(input);
  const profile = await findProfileForWallets(authorizedWallets);
  const walletCluster = authorizedWallets[0]
    ? await getIdentityClusterByWallet(authorizedWallets[0])
    : null;
  const aggregated = authorizedWallets.length > 0
    ? await getAggregatedUserByWallets(authorizedWallets)
    : null;

  return {
    privyUserId: input.privyUserId,
    xUserId,
    xHandle,
    authorizedWallets,
    profileId: profile?.profile_id ?? null,
    profile,
    walletCluster,
    aggregatedHeat: aggregated?.island_heat ?? 0,
    tier: aggregated?.tier ?? "drifter",
  };
}

export async function buildRegisterSignature(input: {
  wallet: string;
  session: SessionIdentity;
}) {
  const wallet = requireSessionWallet(input.wallet, input.session);
  const deadline = signatureDeadline();
  const salt = randomSalt();
  const heatScore = BigInt(Math.max(0, Math.round(input.session.aggregatedHeat)));

  const signature = await backendSignerAccount.signTypedData({
    domain: {
      name: "IslandIdentity",
      version: "1",
      chainId: ONCHAIN_CONTRACTS.chainId,
      verifyingContract: ONCHAIN_CONTRACTS.islandIdentity,
    },
    primaryType: "Register",
    types: {
      Register: [
        { name: "xUserId", type: "uint64" },
        { name: "xHandle", type: "string" },
        { name: "wallet", type: "address" },
        { name: "heatScore", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      xUserId: input.session.xUserId,
      xHandle: input.session.xHandle.replace(/^@+/, ""),
      wallet: wallet as Address,
      heatScore,
      salt,
      deadline,
    },
  });

  return {
    contract_address: ONCHAIN_CONTRACTS.islandIdentity,
    wallet,
    x_user_id: input.session.xUserId.toString(),
    x_handle: input.session.xHandle.replace(/^@+/, ""),
    heat_score: heatScore.toString(),
    salt,
    deadline: deadline.toString(),
    sig: signature,
  };
}

export async function buildLinkWalletSignature(input: {
  wallet: string;
  session: SessionIdentity;
}) {
  if (!input.session.profileId) {
    throw new ApiError(409, "profile_required", "Create a profile before linking another wallet");
  }

  const wallet = requireSessionWallet(input.wallet, input.session);
  const deadline = signatureDeadline();
  const salt = randomSalt();

  const signature = await backendSignerAccount.signTypedData({
    domain: {
      name: "IslandIdentity",
      version: "1",
      chainId: ONCHAIN_CONTRACTS.chainId,
      verifyingContract: ONCHAIN_CONTRACTS.islandIdentity,
    },
    primaryType: "LinkWallet",
    types: {
      LinkWallet: [
        { name: "profileId", type: "uint256" },
        { name: "wallet", type: "address" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      profileId: BigInt(input.session.profileId),
      wallet: wallet as Address,
      salt,
      deadline,
    },
  });

  return {
    contract_address: ONCHAIN_CONTRACTS.islandIdentity,
    wallet,
    profile_id: input.session.profileId,
    salt,
    deadline: deadline.toString(),
    sig: signature,
  };
}

async function getBungalowAssetRows(bungalowId: number): Promise<Array<{
  chain: string;
  token_address: string;
}>> {
  await ensureOnchainSchema();
  const rows = await db<Array<{ chain: string; token_address: string }>>`
    SELECT chain, token_address
    FROM ${db(CONFIG.SCHEMA)}.${db(BUNGALOW_ASSET_TABLE)}
    WHERE bungalow_id = ${bungalowId}
    ORDER BY added_at_unix ASC
  `;

  if (rows.length > 0) {
    return rows;
  }

  await syncBungalowById(bungalowId);
  return await db<Array<{ chain: string; token_address: string }>>`
    SELECT chain, token_address
    FROM ${db(CONFIG.SCHEMA)}.${db(BUNGALOW_ASSET_TABLE)}
    WHERE bungalow_id = ${bungalowId}
    ORDER BY added_at_unix ASC
  `;
}

export async function computeBackendBungalowHeat(input: {
  profileId: number;
  bungalowId: number;
}): Promise<number> {
  const profile = await loadStoredProfile(input.profileId) ?? await syncProfileById(input.profileId);
  const assets = await getBungalowAssetRows(input.bungalowId);
  if (profile.wallets.length === 0 || assets.length === 0) return 0;

  const rows = await db<Array<{
    wallet: string;
    token_address: string;
    chain: string;
    heat_degrees: string;
  }>>`
    SELECT wallet, token_address, chain, heat_degrees::text AS heat_degrees
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE wallet IN ${db(profile.wallets)}
  `;

  const assetKeys = new Set(
    assets.map((asset) => `${asset.chain}:${asset.token_address}`),
  );

  return rows.reduce((sum, row) => {
    if (!assetKeys.has(`${row.chain}:${row.token_address}`)) {
      return sum;
    }
    return sum + safeNumber(row.heat_degrees);
  }, 0);
}

export async function buildSyncHeatSignature(input: {
  bungalowId: number;
  wallet: string;
  session: SessionIdentity;
}) {
  if (!input.session.profileId) {
    throw new ApiError(409, "profile_required", "Create a profile before syncing heat");
  }

  const wallet = requireSessionWallet(input.wallet, input.session);
  const linkedWallets = input.session.profile?.wallets ?? [];
  if (!linkedWallets.some((entry) => entry.toLowerCase() === wallet.toLowerCase())) {
    throw new ApiError(409, "wallet_not_linked", "Link this wallet onchain before syncing heat");
  }

  const heatScore = Math.max(
    0,
    Math.round(await computeBackendBungalowHeat({
      profileId: input.session.profileId,
      bungalowId: input.bungalowId,
    })),
  );
  const deadline = signatureDeadline();
  const salt = randomSalt();

  const signature = await backendSignerAccount.signTypedData({
    domain: {
      name: "IslandIdentity",
      version: "1",
      chainId: ONCHAIN_CONTRACTS.chainId,
      verifyingContract: ONCHAIN_CONTRACTS.islandIdentity,
    },
    primaryType: "SyncHeat",
    types: {
      SyncHeat: [
        { name: "profileId", type: "uint256" },
        { name: "bungalowId", type: "uint256" },
        { name: "heatScore", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      profileId: BigInt(input.session.profileId),
      bungalowId: BigInt(input.bungalowId),
      heatScore: BigInt(heatScore),
      salt,
      deadline,
    },
  });

  return {
    contract_address: ONCHAIN_CONTRACTS.islandIdentity,
    wallet,
    profile_id: input.session.profileId,
    bungalow_id: input.bungalowId,
    heat_score: String(heatScore),
    salt,
    deadline: deadline.toString(),
    sig: signature,
  };
}

async function getOnchainActiveBondHeat(profileId: number): Promise<number> {
  await ensureOnchainSchema();
  const rows = await db<Array<{ heat_score: string }>>`
    SELECT heat_score::text AS heat_score
    FROM ${db(CONFIG.SCHEMA)}.${db(PROFILE_HEAT_TABLE)}
    WHERE profile_id = ${profileId}
      AND bond_activated = TRUE
      AND heat_score::numeric > 0
  `;

  return rows.reduce((sum, row) => sum + safeNumber(row.heat_score), 0);
}

export async function buildDailyClaimSignature(input: {
  wallet: string;
  session: SessionIdentity;
}) {
  if (!input.session.profileId) {
    throw new ApiError(409, "profile_required", "Create a profile before claiming daily JBM");
  }

  const wallet = requireSessionWallet(input.wallet, input.session);
  const linkedWallets = input.session.profile?.wallets ?? [];
  if (!linkedWallets.some((entry) => entry.toLowerCase() === wallet.toLowerCase())) {
    throw new ApiError(409, "wallet_not_linked", "Link this wallet onchain before claiming daily JBM");
  }

  const periodId = currentDailyPeriodId();
  const alreadyClaimed = await publicClient.readContract({
    address: ONCHAIN_CONTRACTS.islandIdentity,
    abi: islandIdentityAbi,
    functionName: "walletClaimedPeriod",
    args: [wallet as Address, periodId],
  }) as boolean;

  if (alreadyClaimed) {
    throw new ApiError(409, "already_claimed", "This wallet already claimed daily JBM for the current period");
  }

  const totalHeat = await getOnchainActiveBondHeat(input.session.profileId);
  if (totalHeat <= 0) {
    throw new ApiError(409, "no_active_bonds", "Install into a bungalow first to activate a permanent bond");
  }

  const amountJbm = Math.max(1, Math.round(Math.min(totalHeat * 10, CONFIG.DAILY_CLAIM_CAP_JBM)));
  const amount = parseUnits(String(amountJbm), 18);
  const deadline = signatureDeadline();
  const salt = randomSalt();

  const signature = await backendSignerAccount.signTypedData({
    domain: {
      name: "IslandIdentity",
      version: "1",
      chainId: ONCHAIN_CONTRACTS.chainId,
      verifyingContract: ONCHAIN_CONTRACTS.islandIdentity,
    },
    primaryType: "ClaimDailyJBM",
    types: {
      ClaimDailyJBM: [
        { name: "wallet", type: "address" },
        { name: "periodId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      wallet: wallet as Address,
      periodId,
      amount,
      salt,
      deadline,
    },
  });

  return {
    contract_address: ONCHAIN_CONTRACTS.islandIdentity,
    wallet,
    profile_id: input.session.profileId,
    period_id: periodId.toString(),
    amount,
    amount_jbm: String(amountJbm),
    salt,
    deadline: deadline.toString(),
    sig: signature,
  };
}

async function getMintQuoteUsdcRaw(input: {
  chain: string;
  tokenAddress: string;
}): Promise<bigint> {
  const normalizedChain = normalizeAssetChain(input.chain);
  if (normalizedChain !== "base" && normalizedChain !== "ethereum") {
    return 0n;
  }

  const market = await fetchDexScreenerData(
    input.tokenAddress,
    normalizedChain as "base" | "ethereum",
  ).catch(() => null);
  const marketCap = safeNumber(market?.marketCap ?? 0);
  const priceUsdc = marketCap > 0 ? Math.max(1, marketCap * 0.001) : 1;
  return parseUnits(priceUsdc.toFixed(2), 6);
}

export async function buildMintQuoteSignature(input: {
  wallet: string;
  chain: string;
  tokenAddress: string;
  session: SessionIdentity;
}) {
  if (!input.session.profileId) {
    throw new ApiError(409, "profile_required", "Create a profile before claiming a bungalow");
  }

  const wallet = requireSessionWallet(input.wallet, input.session);
  const asset = canonicalizeAssetRef({
    chain: input.chain,
    tokenAddress: input.tokenAddress,
  });

  const existingBungalowId = await syncBungalowByAsset({
    chain: asset.chain,
    tokenAddress: asset.tokenAddress,
  });
  if (existingBungalowId) {
    return {
      exists: true,
      bungalow_id: existingBungalowId,
      chain: asset.chain,
      token_address: asset.tokenAddress,
      canonical_path: `/bungalow/${asset.tokenAddress}?chain=${encodeURIComponent(asset.chain)}`,
    };
  }

  const priceRaw = await getMintQuoteUsdcRaw(asset);
  const salt = randomSalt();
  const deadline = signatureDeadline();
  const assetKey = computeAssetKey(asset);

  const signature = await backendSignerAccount.signTypedData({
    domain: {
      name: "JungleBayIsland",
      version: "1",
      chainId: ONCHAIN_CONTRACTS.chainId,
      verifyingContract: ONCHAIN_CONTRACTS.jungleBayIsland,
    },
    primaryType: "MintPrice",
    types: {
      MintPrice: [
        { name: "assetKey", type: "bytes32" },
        { name: "priceUSDC", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      assetKey,
      priceUSDC: priceRaw,
      salt,
      deadline,
    },
  });

  return {
    exists: false,
    contract_address: ONCHAIN_CONTRACTS.jungleBayIsland,
    wallet,
    chain: asset.chain,
    token_address: asset.tokenAddress,
    asset_key: assetKey,
    price_usdc_raw: priceRaw.toString(),
    price_usdc_display: (Number(priceRaw) / 1_000_000).toFixed(2),
    salt,
    deadline: deadline.toString(),
    sig: signature,
    approval_spender: ONCHAIN_CONTRACTS.jungleBayIsland,
  };
}

export async function getOnchainMe(input: {
  privyUserId: string;
  claims: Record<string, unknown> | undefined;
}) {
  await assertBackendSignerAlignment();
  const session = await resolveSessionIdentity(input);
  const user = await getUserByPrivyUserId(input.privyUserId);
  const activeBondHeat = session.profileId ? await getOnchainActiveBondHeat(session.profileId) : 0;

  return {
    contracts: ONCHAIN_CONTRACTS,
    session: {
      privy_user_id: input.privyUserId,
      x_user_id: session.xUserId.toString(),
      x_handle: session.xHandle,
      x_username: user?.x_username ?? session.xHandle,
      wallets: session.authorizedWallets,
    },
    profile: session.profile,
    heat: {
      island_heat: session.aggregatedHeat,
      tier: session.tier,
      active_bond_heat: activeBondHeat,
    },
    next_action: session.profileId ? "enter_island" : "create_profile",
  };
}

async function loadStoredBungalowByAsset(input: {
  chain: string;
  tokenAddress: string;
}): Promise<number | null> {
  await ensureOnchainSchema();
  const asset = canonicalizeAssetRef(input);
  const rows = await db<Array<{ bungalow_id: number }>>`
    SELECT bungalow_id::int AS bungalow_id
    FROM ${db(CONFIG.SCHEMA)}.${db(BUNGALOW_ASSET_TABLE)}
    WHERE asset_key = ${computeAssetKey(asset)}
    LIMIT 1
  `;
  return rows[0]?.bungalow_id ?? null;
}

async function loadBungalowPage(input: {
  chain: string;
  tokenAddress: string;
  session?: SessionIdentity | null;
}): Promise<OnchainBungalowPage> {
  await ensureOnchainSchema();
  const asset = canonicalizeAssetRef(input);
  let bungalowId = await loadStoredBungalowByAsset(asset);
  if (!bungalowId) {
    bungalowId = await syncBungalowByAsset(asset);
  }

  if (!bungalowId) {
    return {
      exists: false,
      bungalow_id: null,
      owner_wallet: null,
      name: null,
      ticker: null,
      ipfs_hash: null,
      minted_at_unix: null,
      seed_asset: null,
      assets: [],
      viewer: {
        wallet: input.session?.authorizedWallets[0] ?? null,
        profile_id: input.session?.profileId ?? null,
        onchain_heat: 0,
        backend_heat: 0,
        can_sync_heat: false,
        owns_bungalow: false,
        bond_activated: false,
      },
      installs: [],
      commissions: [],
    };
  }

  const [bungalowRows, assetRows, installRows, commissionRows] = await Promise.all([
    db<Array<{
      bungalow_id: number;
      owner_wallet: string;
      name: string;
      ticker: string;
      ipfs_hash: string;
      minted_at_unix: number;
      seed_chain: string;
      seed_token_address: string;
    }>>`
      SELECT
        bungalow_id::int AS bungalow_id,
        owner_wallet,
        name,
        ticker,
        ipfs_hash,
        minted_at_unix::int AS minted_at_unix,
        seed_chain,
        seed_token_address
      FROM ${db(CONFIG.SCHEMA)}.${db(BUNGALOW_TABLE)}
      WHERE bungalow_id = ${bungalowId}
      LIMIT 1
    `,
    db<Array<{
      chain: string;
      token_address: string;
      added_at_unix: number;
      is_seed: boolean;
    }>>`
      SELECT
        chain,
        token_address,
        added_at_unix::int AS added_at_unix,
        is_seed
      FROM ${db(CONFIG.SCHEMA)}.${db(BUNGALOW_ASSET_TABLE)}
      WHERE bungalow_id = ${bungalowId}
      ORDER BY added_at_unix ASC
    `,
    db<Array<{
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
      installer_profile_id: number;
      installed_at_unix: number;
    }>>`
      SELECT
        i.item_id::int AS item_id,
        i.creator_profile_id::int AS creator_profile_id,
        p.x_handle AS creator_handle,
        i.ipfs_uri,
        i.price_usdc::text AS price_usdc,
        i.supply::text AS supply,
        i.total_minted::text AS total_minted,
        i.active,
        i.listed_at_unix::int AS listed_at_unix,
        i.commission_id::int AS commission_id,
        inst.installer_profile_id::int AS installer_profile_id,
        inst.installed_at_unix::int AS installed_at_unix
      FROM ${db(CONFIG.SCHEMA)}.${db(INSTALL_TABLE)} inst
      INNER JOIN ${db(CONFIG.SCHEMA)}.${db(ITEM_TABLE)} i
        ON i.item_id = inst.item_id
      LEFT JOIN ${db(CONFIG.SCHEMA)}.${db(PROFILE_TABLE)} p
        ON p.profile_id = i.creator_profile_id
      WHERE inst.bungalow_id = ${bungalowId}
      ORDER BY inst.installed_at_unix DESC
    `,
    db<Array<{
      commission_id: number;
      prompt_uri: string;
      budget_usdc: string;
      deadline_unix: number;
      status: CommissionStatus;
      selected_artist_profile_id: number | null;
      agreed_price_usdc: string | null;
      deliverable_uri: string | null;
      published_at_unix: number;
    }>>`
      SELECT
        commission_id::int AS commission_id,
        prompt_uri,
        budget_usdc::text AS budget_usdc,
        deadline_unix::int AS deadline_unix,
        status::text AS status,
        selected_artist_profile_id::int AS selected_artist_profile_id,
        agreed_price_usdc::text AS agreed_price_usdc,
        deliverable_uri,
        published_at_unix::int AS published_at_unix
      FROM ${db(CONFIG.SCHEMA)}.${db(COMMISSION_TABLE)}
      WHERE bungalow_id = ${bungalowId}
      ORDER BY published_at_unix DESC
      LIMIT 12
    `,
  ]);

  const bungalow = bungalowRows[0];
  if (!bungalow) {
    throw new ApiError(404, "bungalow_not_found", "Bungalow not found");
  }

  const assetMeta = await Promise.all(
    assetRows.map(async (row) => {
      const registry = ["base", "ethereum", "solana"].includes(row.chain)
        ? await getTokenRegistry(
            row.token_address,
            row.chain as "base" | "ethereum" | "solana",
          )
        : null;
      const metadata = ["base", "ethereum", "solana"].includes(row.chain)
        ? await resolveTokenMetadata(
            row.token_address,
            row.chain as "base" | "ethereum" | "solana",
          ).catch(() => null)
        : null;
      return {
        chain: row.chain,
        token_address: row.token_address,
        added_at_unix: row.added_at_unix,
        is_seed: row.is_seed,
        label: registry?.name ?? null,
        symbol: registry?.symbol ?? null,
        image_url: metadata?.image_url ?? null,
      };
    }),
  );

  let onchainHeat = 0;
  let backendHeat = 0;
  let bondActivated = false;
  if (input.session?.profileId) {
    await syncHeatState(input.session.profileId, bungalowId);
    const heatRows = await db<Array<{ heat_score: string; bond_activated: boolean }>>`
      SELECT heat_score::text AS heat_score, bond_activated
      FROM ${db(CONFIG.SCHEMA)}.${db(PROFILE_HEAT_TABLE)}
      WHERE profile_id = ${input.session.profileId}
        AND bungalow_id = ${bungalowId}
      LIMIT 1
    `;
    onchainHeat = safeNumber(heatRows[0]?.heat_score ?? 0);
    bondActivated = Boolean(heatRows[0]?.bond_activated);
    backendHeat = await computeBackendBungalowHeat({
      profileId: input.session.profileId,
      bungalowId,
    });
  }

  return {
    exists: true,
    bungalow_id: bungalow.bungalow_id,
    owner_wallet: bungalow.owner_wallet,
    name: bungalow.name || null,
    ticker: bungalow.ticker || null,
    ipfs_hash: bungalow.ipfs_hash || null,
    minted_at_unix: bungalow.minted_at_unix,
    seed_asset: {
      chain: bungalow.seed_chain,
      token_address: bungalow.seed_token_address,
    },
    assets: assetMeta,
    viewer: {
      wallet: input.session?.authorizedWallets[0] ?? null,
      profile_id: input.session?.profileId ?? null,
      onchain_heat: onchainHeat,
      backend_heat: backendHeat,
      can_sync_heat: input.session?.profileId
        ? Math.round(backendHeat) !== Math.round(onchainHeat)
        : false,
      owns_bungalow: Boolean(
        input.session?.authorizedWallets.some(
          (wallet) => wallet.toLowerCase() === bungalow.owner_wallet.toLowerCase(),
        ),
      ),
      bond_activated: bondActivated,
    },
    installs: installRows.map((row) => ({
      ...row,
      installed_by_profile_id: row.installer_profile_id,
    })),
    commissions: commissionRows,
  };
}

export async function resolveBungalowByAsset(input: {
  chain: string;
  tokenAddress: string;
  session?: SessionIdentity | null;
}) {
  return await loadBungalowPage(input);
}

export async function listBodegaItems(input?: {
  bungalowId?: number | null;
  creatorProfileId?: number | null;
  limit?: number;
}) {
  await ensureOnchainSchema();
  const limit = Math.max(1, Math.min(100, input?.limit ?? 48));
  const where: string[] = [];
  const params: Array<number | string> = [];

  if (input?.creatorProfileId) {
    params.push(input.creatorProfileId);
    where.push(`i.creator_profile_id = $${params.length}`);
  }
  if (input?.bungalowId) {
    params.push(input.bungalowId);
    where.push(`EXISTS (
      SELECT 1
      FROM "${CONFIG.SCHEMA}".${INSTALL_TABLE} inst
      WHERE inst.item_id = i.item_id
        AND inst.bungalow_id = $${params.length}
    )`);
  }

  params.push(limit);
  const query = `
    SELECT
      i.item_id::int AS item_id,
      i.creator_profile_id::int AS creator_profile_id,
      p.x_handle AS creator_handle,
      i.ipfs_uri,
      i.supply::text AS supply,
      i.price_usdc::text AS price_usdc,
      i.total_minted::text AS total_minted,
      i.active,
      i.listed_at_unix::int AS listed_at_unix,
      i.commission_id::int AS commission_id
    FROM "${CONFIG.SCHEMA}".${ITEM_TABLE} i
    LEFT JOIN "${CONFIG.SCHEMA}".${PROFILE_TABLE} p
      ON p.profile_id = i.creator_profile_id
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY i.listed_at_unix DESC
    LIMIT $${params.length}
  `;

  return await db.unsafe(query, params) as Array<{
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
  }>;
}

export async function getCommissionList(input: {
  scope?: string | null;
  session?: SessionIdentity | null;
  limit?: number;
}) {
  await ensureOnchainSchema();
  const limit = Math.max(1, Math.min(100, input.limit ?? 48));
  const params: Array<number | string> = [];
  const where: string[] = [];
  const scope = (input.scope ?? "open").trim().toLowerCase();
  const profileId = input.session?.profileId ?? null;

  if (scope === "open") {
    where.push(`c.status = 'OPEN'`);
  } else if (scope === "requesting" && profileId) {
    params.push(profileId);
    where.push(`c.requester_profile_id = $${params.length}`);
  } else if (scope === "working" && profileId) {
    params.push(profileId);
    where.push(`(
      c.selected_artist_profile_id = $${params.length}
      OR EXISTS (
        SELECT 1
        FROM "${CONFIG.SCHEMA}".${APPLICATION_TABLE} a
        WHERE a.commission_id = c.commission_id
          AND a.artist_profile_id = $${params.length}
      )
    )`);
  } else if (scope === "resolved") {
    where.push(`c.status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'TIMED_OUT', 'DEADLINE_MISSED')`);
  }

  params.push(limit);
  const rows = await db.unsafe(
    `
      SELECT
        c.commission_id::int AS commission_id,
        c.requester_profile_id::int AS requester_profile_id,
        requester.x_handle AS requester_handle,
        c.bungalow_id::int AS bungalow_id,
        c.prompt_uri,
        c.budget_usdc::text AS budget_usdc,
        c.deadline_unix::int AS deadline_unix,
        c.published_at_unix::int AS published_at_unix,
        c.selected_artist_profile_id::int AS selected_artist_profile_id,
        c.agreed_price_usdc::text AS agreed_price_usdc,
        c.deliverable_uri,
        c.status::text AS status,
        bungalow.name AS bungalow_name,
        bungalow.seed_chain,
        bungalow.seed_token_address,
        (
          SELECT COUNT(*)::int
          FROM "${CONFIG.SCHEMA}".${APPLICATION_TABLE} a
          WHERE a.commission_id = c.commission_id
        ) AS application_count
      FROM "${CONFIG.SCHEMA}".${COMMISSION_TABLE} c
      LEFT JOIN "${CONFIG.SCHEMA}".${PROFILE_TABLE} requester
        ON requester.profile_id = c.requester_profile_id
      LEFT JOIN "${CONFIG.SCHEMA}".${BUNGALOW_TABLE} bungalow
        ON bungalow.bungalow_id = c.bungalow_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.published_at_unix DESC
      LIMIT $${params.length}
    `,
    params,
  ) as Array<{
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
    status: CommissionStatus;
    bungalow_name: string | null;
    seed_chain: string | null;
    seed_token_address: string | null;
    application_count: number;
  }>;

  return {
    items: rows,
    scope,
    viewer_profile_id: profileId,
  };
}

export async function getCommissionDetail(input: {
  commissionId: number;
  session?: SessionIdentity | null;
}) {
  await ensureOnchainSchema();
  await syncCommissionById(input.commissionId);

  const [commissionRows, applicationRows] = await Promise.all([
    db.unsafe(
      `
        SELECT
          c.commission_id::int AS commission_id,
          c.requester_profile_id::int AS requester_profile_id,
          requester.x_handle AS requester_handle,
          c.bungalow_id::int AS bungalow_id,
          bungalow.name AS bungalow_name,
          bungalow.seed_chain,
          bungalow.seed_token_address,
          c.prompt_uri,
          c.budget_usdc::text AS budget_usdc,
          c.deadline_unix::int AS deadline_unix,
          c.published_at_unix::int AS published_at_unix,
          c.selected_at_unix::int AS selected_at_unix,
          c.submitted_at_unix::int AS submitted_at_unix,
          c.selected_artist_profile_id::int AS selected_artist_profile_id,
          artist.x_handle AS selected_artist_handle,
          c.agreed_price_usdc::text AS agreed_price_usdc,
          c.deliverable_uri,
          c.status::text AS status,
          c.item_id::int AS item_id,
          c.artist_reputation::text AS artist_reputation,
          c.artist_warning,
          c.requester_rejections::text AS requester_rejections,
          c.requester_warning
        FROM "${CONFIG.SCHEMA}".${COMMISSION_TABLE} c
        LEFT JOIN "${CONFIG.SCHEMA}".${PROFILE_TABLE} requester
          ON requester.profile_id = c.requester_profile_id
        LEFT JOIN "${CONFIG.SCHEMA}".${PROFILE_TABLE} artist
          ON artist.profile_id = c.selected_artist_profile_id
        LEFT JOIN "${CONFIG.SCHEMA}".${BUNGALOW_TABLE} bungalow
          ON bungalow.bungalow_id = c.bungalow_id
        WHERE c.commission_id = $1
        LIMIT 1
      `,
      [input.commissionId],
    ) as Promise<Array<Record<string, unknown>>>,
    db.unsafe(
      `
        SELECT
          a.application_id::int AS application_id,
          a.commission_id::int AS commission_id,
          a.artist_profile_id::int AS artist_profile_id,
          p.x_handle AS artist_handle,
          a.pitch_uri,
          a.proposed_price_usdc::text AS proposed_price_usdc,
          a.applied_at_unix::int AS applied_at_unix,
          a.active
        FROM "${CONFIG.SCHEMA}".${APPLICATION_TABLE} a
        LEFT JOIN "${CONFIG.SCHEMA}".${PROFILE_TABLE} p
          ON p.profile_id = a.artist_profile_id
        WHERE a.commission_id = $1
        ORDER BY a.applied_at_unix ASC
      `,
      [input.commissionId],
    ) as Promise<Array<Record<string, unknown>>>,
  ]);

  const commission = commissionRows[0];
  if (!commission) {
    throw new ApiError(404, "commission_not_found", "Commission not found");
  }

  const viewerProfileId = input.session?.profileId ?? null;
  const isRequester = viewerProfileId === safeNumber(commission.requester_profile_id);
  const isSelectedArtist =
    viewerProfileId !== null &&
    viewerProfileId === safeNumber(commission.selected_artist_profile_id);
  const now = Math.floor(Date.now() / 1000);
  const selectedAtUnix = safeNumber(commission.selected_at_unix);
  const submittedAtUnix = safeNumber(commission.submitted_at_unix);
  const reviewWindowEnds = submittedAtUnix > 0 ? submittedAtUnix + 3 * 24 * 60 * 60 : 0;
  const selectionWindowEnds = safeNumber(commission.published_at_unix) + 24 * 60 * 60;
  const deadlineUnix = safeNumber(commission.deadline_unix);
  const status = String(commission.status) as CommissionStatus;

  return {
    commission,
    applications: applicationRows,
    viewer: {
      authenticated: Boolean(input.session),
      profile_id: viewerProfileId,
      is_requester: isRequester,
      is_selected_artist: isSelectedArtist,
      can_apply:
        Boolean(viewerProfileId) &&
        !isRequester &&
        status === "OPEN" &&
        now <= selectionWindowEnds &&
        now <= deadlineUnix &&
        !applicationRows.some((row) => safeNumber(row.artist_profile_id) === viewerProfileId),
      can_select_artist: isRequester && status === "OPEN" && now <= selectionWindowEnds,
      can_submit_work: isSelectedArtist && status === "SELECTED" && now <= deadlineUnix,
      can_approve_payout: isRequester && status === "SUBMITTED" && now < reviewWindowEnds,
      can_reject_refund: isRequester && status === "SUBMITTED" && now < reviewWindowEnds,
      can_claim_timeout: isSelectedArtist && status === "SUBMITTED" && reviewWindowEnds > 0 && now >= reviewWindowEnds,
      can_reclaim_missed_deadline: isRequester && status === "SELECTED" && now > deadlineUnix,
      can_expire: isRequester && status === "OPEN" && now > selectionWindowEnds,
      review_window_ends_unix: reviewWindowEnds,
      selection_window_ends_unix: selectionWindowEnds,
    },
  };
}

function decodeContractLog(log: Log) {
  const contractName = CONTRACT_ADDRESS_TO_NAME.get(log.address.toLowerCase());
  if (!contractName) return null;

  try {
    const decoded = decodeEventLog({
      abi: CONTRACT_ABI_BY_NAME[contractName],
      data: log.data,
      topics: log.topics,
      strict: false,
    });
    return {
      contractName,
      eventName: decoded.eventName,
      args: decoded.args,
    };
  } catch {
    return null;
  }
}

async function recordRawLog(input: {
  receipt: TransactionReceipt;
  log: Log;
  decoded: NonNullable<ReturnType<typeof decodeContractLog>>;
}): Promise<void> {
  await ensureOnchainSchema();
  await db.unsafe(
    `
      INSERT INTO "${CONFIG.SCHEMA}".${CONTRACT_EVENT_TABLE} (
        chain_id,
        block_number,
        transaction_hash,
        transaction_index,
        log_index,
        contract_address,
        contract_name,
        event_name,
        event_args,
        indexing_status,
        first_seen_at,
        confirmed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'indexed',NOW(),NOW())
      ON CONFLICT (chain_id, transaction_hash, log_index)
      DO UPDATE SET
        contract_address = EXCLUDED.contract_address,
        contract_name = EXCLUDED.contract_name,
        event_name = EXCLUDED.event_name,
        event_args = EXCLUDED.event_args,
        indexing_status = 'indexed',
        confirmed_at = NOW()
    `,
    [
      ONCHAIN_CONTRACTS.chainId,
      input.receipt.blockNumber.toString(),
      input.receipt.transactionHash,
      input.receipt.transactionIndex,
      input.log.logIndex,
      input.log.address,
      input.decoded.contractName,
      input.decoded.eventName,
      toJson(input.decoded.args),
    ],
  );
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return BigInt(value);
  return 0n;
}

function asOptionalBigInt(value: unknown): bigint | null {
  const bigint = asBigInt(value);
  return bigint > 0n ? bigint : null;
}

export function collectReceiptEffects(
  receipt: TransactionReceipt,
  input?: { blockTimestampUnix?: number },
) {
  const profileIds = new Set<number>();
  const bungalowIds = new Set<number>();
  const itemIds = new Set<number>();
  const commissionIds = new Set<number>();
  const applicationIds = new Set<number>();
  const heatPairs = new Set<string>();
  const dailyClaims: Array<{
    wallet: string;
    profileId: number;
    periodId: number;
    amount: string;
    claimedAtUnix: number;
    txHash: string;
  }> = [];
  const installs: Array<{
    bungalowId: number;
    itemId: number;
    installerProfileId: number;
    priceUsdc: string;
    installedAtUnix: number;
    txHash: string;
  }> = [];
  const commissionItemIds = new Map<number, number>();
  const eventTimestampUnix = input?.blockTimestampUnix ?? Number(receipt.blockNumber);

  for (const log of receipt.logs) {
    const decoded = decodeContractLog(log);
    if (!decoded) continue;
    const args = decoded.args as Record<string, unknown>;

    switch (`${decoded.contractName}:${decoded.eventName}`) {
      case "IslandIdentity:ProfileRegistered":
        profileIds.add(Number(asBigInt(args.profileId)));
        break;
      case "IslandIdentity:WalletLinked":
      case "IslandIdentity:WalletUnlinked":
      case "IslandIdentity:HandleUpdated":
      case "IslandIdentity:HardcoreWarningSet":
        profileIds.add(Number(asBigInt(args.profileId)));
        break;
      case "IslandIdentity:HeatSynced":
      case "IslandIdentity:BondActivated": {
        const profileId = Number(asBigInt(args.profileId));
        const bungalowId = Number(asBigInt(args.bungalowId));
        profileIds.add(profileId);
        bungalowIds.add(bungalowId);
        heatPairs.add(`${profileId}:${bungalowId}`);
        break;
      }
      case "IslandIdentity:JBMClaimed": {
        const wallet = String(args.wallet).toLowerCase();
        const profileId = Number(asBigInt(args.profileId));
        const periodId = Number(asBigInt(args.periodId));
        profileIds.add(profileId);
        dailyClaims.push({
          wallet,
          profileId,
          periodId,
          amount: asBigInt(args.amount).toString(),
          claimedAtUnix: eventTimestampUnix,
          txHash: receipt.transactionHash,
        });
        break;
      }
      case "JungleBayIsland:BungalowMinted":
      case "JungleBayIsland:BungalowUpdated":
      case "JungleBayIsland:BungalowIdentityUpdated":
      case "JungleBayIsland:AssetLinked":
      case "JungleBayIsland:Transfer":
        bungalowIds.add(Number(asBigInt(args.tokenId)));
        break;
      case "Bodega:ItemListed":
      case "Bodega:ItemActiveStatusUpdated":
        itemIds.add(Number(asBigInt(args.itemId)));
        break;
      case "Bodega:ItemInstalled": {
        const itemId = Number(asBigInt(args.itemId));
        const bungalowId = Number(asBigInt(args.bungalowId));
        const installerProfileId = Number(asBigInt(args.installerProfileId));
        itemIds.add(itemId);
        bungalowIds.add(bungalowId);
        profileIds.add(installerProfileId);
        installs.push({
          bungalowId,
          itemId,
          installerProfileId,
          priceUsdc: asBigInt(args.priceUSDC).toString(),
          installedAtUnix: eventTimestampUnix,
          txHash: receipt.transactionHash,
        });
        break;
      }
      case "CommissionManager:CommissionPublished":
      case "CommissionManager:CommissionRejected":
      case "CommissionManager:CommissionDeadlineMissed":
      case "CommissionManager:CommissionExpired":
      case "CommissionManager:CommissionTimedOut":
      case "CommissionManager:DeliverableSubmitted":
        commissionIds.add(Number(asBigInt(args.commissionId)));
        break;
      case "CommissionManager:ApplicationSubmitted":
        applicationIds.add(Number(asBigInt(args.applicationId)));
        commissionIds.add(Number(asBigInt(args.commissionId)));
        break;
      case "CommissionManager:ArtistSelected":
        commissionIds.add(Number(asBigInt(args.commissionId)));
        applicationIds.add(Number(asBigInt(args.applicationId)));
        profileIds.add(Number(asBigInt(args.artistProfileId)));
        break;
      case "CommissionManager:CommissionApproved": {
        const commissionId = Number(asBigInt(args.commissionId));
        const itemId = Number(asBigInt(args.itemId));
        commissionIds.add(commissionId);
        itemIds.add(itemId);
        commissionItemIds.set(commissionId, itemId);
        break;
      }
      case "CommissionManager:ReputationEarned":
      case "CommissionManager:HardcoreWarningSet":
        profileIds.add(Number(asBigInt(args.profileId ?? args.artistProfileId)));
        break;
      default:
        break;
    }
  }

  return {
    profileIds,
    bungalowIds,
    itemIds,
    commissionIds,
    applicationIds,
    heatPairs,
    dailyClaims,
    installs,
    commissionItemIds,
  };
}

async function applyReceiptEffects(receipt: TransactionReceipt): Promise<{
  profileIds: number[];
  bungalowIds: number[];
  itemIds: number[];
  commissionIds: number[];
  applicationIds: number[];
}> {
  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  }).catch(() => null);
  const effects = collectReceiptEffects(receipt, {
    blockTimestampUnix: block ? bigintToNumber(block.timestamp) : undefined,
  });
  for (const log of receipt.logs) {
    const decoded = decodeContractLog(log);
    if (!decoded) continue;
    await recordRawLog({ receipt, log, decoded });
  }

  for (const profileId of effects.profileIds) {
    await syncProfileById(profileId);
  }
  for (const bungalowId of effects.bungalowIds) {
    await syncBungalowById(bungalowId);
  }
  for (const [commissionId, itemId] of effects.commissionItemIds) {
    await syncCommissionById(commissionId, itemId);
    await syncItemById(itemId, commissionId);
  }
  for (const itemId of effects.itemIds) {
    await syncItemById(itemId);
  }
  for (const applicationId of effects.applicationIds) {
    await syncCommissionApplicationById(applicationId);
  }
  for (const commissionId of effects.commissionIds) {
    await syncCommissionById(commissionId, effects.commissionItemIds.get(commissionId) ?? null);
  }
  for (const pair of effects.heatPairs) {
    const [profileId, bungalowId] = pair.split(":").map((value) => Number.parseInt(value, 10));
    if (profileId > 0 && bungalowId > 0) {
      await syncHeatState(profileId, bungalowId);
    }
  }
  for (const install of effects.installs) {
    await db.unsafe(
      `
        INSERT INTO "${CONFIG.SCHEMA}".${INSTALL_TABLE} (
          bungalow_id,
          item_id,
          installer_profile_id,
          price_usdc,
          tx_hash,
          installed_at_unix
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (bungalow_id, item_id)
        DO UPDATE SET
          installer_profile_id = EXCLUDED.installer_profile_id,
          price_usdc = EXCLUDED.price_usdc,
          tx_hash = EXCLUDED.tx_hash,
          installed_at_unix = EXCLUDED.installed_at_unix
      `,
      [
        install.bungalowId,
        install.itemId,
        install.installerProfileId,
        install.priceUsdc,
        install.txHash,
        install.installedAtUnix,
      ],
    );
    await syncHeatState(install.installerProfileId, install.bungalowId);
  }
  for (const claim of effects.dailyClaims) {
    await db.unsafe(
      `
        INSERT INTO "${CONFIG.SCHEMA}".${DAILY_CLAIM_TABLE} (
          wallet,
          period_id,
          profile_id,
          amount,
          tx_hash,
          claimed_at_unix
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (wallet, period_id)
        DO UPDATE SET
          profile_id = EXCLUDED.profile_id,
          amount = EXCLUDED.amount,
          tx_hash = EXCLUDED.tx_hash,
          claimed_at_unix = EXCLUDED.claimed_at_unix
      `,
      [
        claim.wallet,
        claim.periodId,
        claim.profileId,
        claim.amount,
        claim.txHash,
        claim.claimedAtUnix,
      ],
    );
  }

  return {
    profileIds: [...effects.profileIds],
    bungalowIds: [...effects.bungalowIds],
    itemIds: [...effects.itemIds],
    commissionIds: [...effects.commissionIds],
    applicationIds: [...effects.applicationIds],
  };
}

export async function confirmTrackedTransaction(input: {
  txHash: string;
}): Promise<{
  status: OnchainInteractionStatus;
  receipt: TransactionReceipt | null;
  derived: {
    profile_ids: number[];
    bungalow_ids: number[];
    item_ids: number[];
    commission_ids: number[];
    application_ids: number[];
  } | null;
}> {
  const txHash = input.txHash.toLowerCase();
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as Hex,
  }).catch(() => null);

  if (!receipt) {
    await updateOnchainInteraction(txHash, {
      status: "submitted",
    });
    return {
      status: "submitted",
      receipt: null,
      derived: null,
    };
  }

  if (receipt.status !== "success") {
    await updateOnchainInteraction(txHash, {
      status: "failed",
      blockNumber: Number(receipt.blockNumber),
      confirmedAt: new Date().toISOString(),
      errorMessage: "Transaction reverted onchain",
    });
    return {
      status: "failed",
      receipt,
      derived: null,
    };
  }

  const derived = await applyReceiptEffects(receipt);
  await updateOnchainInteraction(txHash, {
    status: "indexed",
    blockNumber: Number(receipt.blockNumber),
    confirmedAt: new Date().toISOString(),
    profileId: derived.profileIds[0] ?? null,
    bungalowId: derived.bungalowIds[0] ?? null,
    itemId: derived.itemIds[0] ?? null,
    commissionId: derived.commissionIds[0] ?? null,
    applicationId: derived.applicationIds[0] ?? null,
    metadata: {
      log_count: receipt.logs.length,
      derived,
    },
  });

  return {
    status: "indexed",
    receipt,
    derived: {
      profile_ids: derived.profileIds,
      bungalow_ids: derived.bungalowIds,
      item_ids: derived.itemIds,
      commission_ids: derived.commissionIds,
      application_ids: derived.applicationIds,
    },
  };
}

export async function runOnchainBackfill(input?: {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
}) {
  await ensureOnchainSchema();
  const dryRun = Boolean(input?.dryRun);
  const batchSize = BigInt(Math.max(100, input?.batchSize ?? 2_000));
  const maxBatches = Math.max(1, input?.maxBatches ?? 1);
  const latestBlock = await publicClient.getBlockNumber();

  const contracts = [
    { name: "IslandIdentity" as const, address: ONCHAIN_CONTRACTS.islandIdentity },
    { name: "JungleBayIsland" as const, address: ONCHAIN_CONTRACTS.jungleBayIsland },
    { name: "Bodega" as const, address: ONCHAIN_CONTRACTS.bodega },
    { name: "CommissionManager" as const, address: ONCHAIN_CONTRACTS.commissionManager },
  ];

  const summary: Array<{
    contract: OnchainContractName;
    from_block: string;
    to_block: string;
    log_count: number;
  }> = [];

  for (const contract of contracts) {
    const cursorRows = await db<Array<{ next_from_block: string }>>`
      SELECT next_from_block::text AS next_from_block
      FROM ${db(CONFIG.SCHEMA)}.${db(CONTRACT_CURSOR_TABLE)}
      WHERE chain_id = ${ONCHAIN_CONTRACTS.chainId}
        AND contract_name = ${contract.name}
        AND contract_address = ${contract.address}
      LIMIT 1
    `;

    let fromBlock = cursorRows[0]?.next_from_block
      ? BigInt(cursorRows[0].next_from_block)
      : getInitialBackfillStartBlock();

    let batches = 0;
    while (fromBlock <= latestBlock && batches < maxBatches) {
      const toBlock = fromBlock + batchSize - 1n > latestBlock
        ? latestBlock
        : fromBlock + batchSize - 1n;

      const logs = await publicClient.getLogs({
        address: contract.address,
        fromBlock,
        toBlock,
      });

      summary.push({
        contract: contract.name,
        from_block: fromBlock.toString(),
        to_block: toBlock.toString(),
        log_count: logs.length,
      });

      if (!dryRun) {
        for (const log of logs) {
          const receipt = await publicClient.getTransactionReceipt({
            hash: log.transactionHash,
          }).catch(() => null);
          if (!receipt) continue;
          await applyReceiptEffects(receipt);
        }

        await db.unsafe(
          `
            INSERT INTO "${CONFIG.SCHEMA}".${CONTRACT_CURSOR_TABLE} (
              chain_id,
              contract_name,
              contract_address,
              next_from_block,
              updated_at
            )
            VALUES ($1,$2,$3,$4,NOW())
            ON CONFLICT (chain_id, contract_name, contract_address)
            DO UPDATE SET
              next_from_block = EXCLUDED.next_from_block,
              updated_at = NOW()
          `,
          [
            ONCHAIN_CONTRACTS.chainId,
            contract.name,
            contract.address,
            (toBlock + 1n).toString(),
          ],
        );
      }

      fromBlock = toBlock + 1n;
      batches += 1;
    }
  }

  return {
    dry_run: dryRun,
    latest_block: latestBlock.toString(),
    batches: summary,
  };
}
