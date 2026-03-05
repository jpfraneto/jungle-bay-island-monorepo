import { Hono } from "hono";
import { keccak256, parseUnits, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getAggregatedUserByWallets,
  getIdentityClusterByWallet,
  getWalletTokenHeats,
  type IdentityClusterWallet,
} from "../db/queries";
import { optionalWalletContext } from "../middleware/auth";
import { resolveUserWalletMap } from "../services/identityMap";
import {
  CONFIG,
  db,
  normalizeAddress,
  publicClients,
  toSupportedChain,
} from "../config";
import { ApiError } from "../services/errors";
import type { AppEnv } from "../types";

const claimsRoute = new Hono<AppEnv>();
claimsRoute.use("/claims/*", optionalWalletContext);

const REWARD_RESET_HOUR_UTC = 12;
const REWARD_RESET_OFFSET_SECONDS = REWARD_RESET_HOUR_UTC * 3600;
const JBM_PER_HEAT_DEGREE = 100;
const DAILY_DISTRIBUTION_CAP_JBM = BigInt(Math.max(0, CONFIG.DAILY_CLAIM_CAP_JBM));
const WEI_PER_JBM = 10n ** 18n;

const CLAIM_ESCROW_ABI = [
  {
    name: "claimPeriodTotal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrow", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "periodId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "breakdownHash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "hasClaimedPeriod",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "periodId", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface ClaimAllocationRow {
  identity_key: string;
  identity_source: "privy" | "farcaster" | "wallet";
  identity_value: string;
  chain: "base" | "ethereum" | "solana";
  token_address: string;
  period_id: number;
  heat_degrees: string;
  reward_jbm: string;
  wallets_snapshot: unknown;
  created_at: string;
  claimed_at: string | null;
  claimant_wallet: string | null;
  claim_nonce: number | null;
  signature: string | null;
  amount_wei: string | null;
  deadline: number | null;
}

interface ClaimPeriodCapRow {
  period_id: number;
  cap_jbm: string;
  distributed_jbm: string;
  updated_at: string;
}

interface ResolvedIdentity {
  identity_key: string;
  identity_source: "privy" | "farcaster" | "wallet";
  identity_value: string;
  wallets: IdentityClusterWallet[];
  evm_wallets: string[];
  solana_wallets: string[];
  x_username: string | null;
  farcaster: {
    fid: number;
    username: string | null;
    display_name: string | null;
    pfp_url: string | null;
  } | null;
}

let claimRewardsTablePromise: Promise<void> | null = null;

async function ensureClaimRewardsTable(): Promise<void> {
  if (!claimRewardsTablePromise) {
    claimRewardsTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.claim_daily_allocations (
          id BIGSERIAL PRIMARY KEY,
          identity_key TEXT NOT NULL,
          identity_source TEXT NOT NULL,
          identity_value TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_address TEXT NOT NULL,
          period_id INTEGER NOT NULL,
          heat_degrees NUMERIC NOT NULL DEFAULT 0,
          reward_jbm NUMERIC NOT NULL DEFAULT 0,
          wallets_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          claimed_at TIMESTAMPTZ,
          claimant_wallet TEXT,
          claim_nonce INTEGER,
          signature TEXT,
          amount_wei NUMERIC,
          deadline INTEGER,
          CONSTRAINT claim_daily_identity_period_unique
            UNIQUE (identity_key, chain, token_address, period_id)
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_claim_daily_identity
        ON ${db(CONFIG.SCHEMA)}.claim_daily_allocations (identity_key, period_id DESC)
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_claim_daily_token
        ON ${db(CONFIG.SCHEMA)}.claim_daily_allocations (chain, token_address, period_id DESC)
      `;

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.claim_period_caps (
          period_id INTEGER PRIMARY KEY,
          cap_jbm NUMERIC NOT NULL,
          distributed_jbm NUMERIC NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.claim_period_caps
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `;
    })();
  }

  await claimRewardsTablePromise;
}

function getCurrentPeriodId(nowMs = Date.now()): number {
  const unix = Math.floor(nowMs / 1000);
  return Math.floor((unix - REWARD_RESET_OFFSET_SECONDS) / 86400);
}

function getPeriodStartIso(periodId: number): string {
  const periodStartUnix = periodId * 86400 + REWARD_RESET_OFFSET_SECONDS;
  return new Date(periodStartUnix * 1000).toISOString();
}

function getPeriodEndIso(periodId: number): string {
  const periodEndUnix = (periodId + 1) * 86400 + REWARD_RESET_OFFSET_SECONDS;
  return new Date(periodEndUnix * 1000).toISOString();
}

function parseNumericBigInt(value: string | null | undefined): bigint {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  const normalized = trimmed.includes(".") ? trimmed.split(".")[0] : trimmed;
  if (!normalized || normalized === "-") return 0n;
  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

function extractRevertReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(
    /reverted with the following reason:\s*([\s\S]*?)(?:\n\s*Contract Call:|$)/i,
  );
  if (match?.[1]) return match[1].trim();
  return null;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function parseWalletSnapshot(value: unknown): Array<{ wallet: string; heat_degrees: number }> {
  if (Array.isArray(value)) {
    return value
      .map((row) => {
        const candidate = row as Record<string, unknown>;
        const wallet = typeof candidate.wallet === "string" ? candidate.wallet : "";
        const heat = Number(candidate.heat_degrees ?? 0);
        if (!wallet || !Number.isFinite(heat)) return null;
        return { wallet, heat_degrees: heat };
      })
      .filter((row): row is { wallet: string; heat_degrees: number } => row !== null);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseWalletSnapshot(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseAllocation(row: ClaimAllocationRow) {
  const rewardJbm = parseNumericBigInt(row.reward_jbm);
  const heatDegrees = Number(row.heat_degrees);

  return {
    ...row,
    heat_degrees_number: Number.isFinite(heatDegrees) ? heatDegrees : 0,
    reward_jbm_bigint: rewardJbm,
    wallets_snapshot_parsed: parseWalletSnapshot(row.wallets_snapshot),
  };
}

function getReservedJbm(amountWei: string | null | undefined): bigint {
  return parseNumericBigInt(amountWei) / WEI_PER_JBM;
}

function getClaimContractAddress(): `0x${string}` | null {
  const address = normalizeAddress(CONFIG.CLAIM_CONTRACT_ADDRESS);
  return address ? (address as `0x${string}`) : null;
}

async function readOnchainClaimStatus(input: {
  claimContractAddress: `0x${string}`;
  periodId: number;
  payoutWallet: string;
}): Promise<boolean> {
  const result = await publicClients.base.readContract({
    address: input.claimContractAddress,
    abi: CLAIM_ESCROW_ABI,
    functionName: "hasClaimedPeriod",
    args: [BigInt(input.periodId), input.payoutWallet as `0x${string}`],
  });

  return Boolean(result);
}

async function readOnchainClaimNonce(input: {
  claimContractAddress: `0x${string}`;
  payoutWallet: string;
}): Promise<number> {
  const result = await publicClients.base.readContract({
    address: input.claimContractAddress,
    abi: CLAIM_ESCROW_ABI,
    functionName: "getNonce",
    args: [input.payoutWallet as `0x${string}`],
  });

  return Number(result);
}

async function readOnchainClaimNonceWithRetry(input: {
  claimContractAddress: `0x${string}`;
  payoutWallet: string;
  retries?: number;
}): Promise<number> {
  const attempts = Math.max(1, input.retries ?? 2);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await readOnchainClaimNonce({
        claimContractAddress: input.claimContractAddress,
        payoutWallet: input.payoutWallet,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("nonce read failed");
}

async function getPeriodCap(periodId: number): Promise<{
  cap_jbm: bigint;
  distributed_jbm: bigint;
  remaining_jbm: bigint;
}> {
  await ensureClaimRewardsTable();

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.claim_period_caps (
      period_id,
      cap_jbm,
      distributed_jbm
    )
    VALUES (
      ${periodId},
      ${DAILY_DISTRIBUTION_CAP_JBM.toString()},
      0
    )
    ON CONFLICT (period_id) DO NOTHING
  `;

  const rows = await db<ClaimPeriodCapRow[]>`
    SELECT
      period_id,
      cap_jbm::text AS cap_jbm,
      distributed_jbm::text AS distributed_jbm,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.claim_period_caps
    WHERE period_id = ${periodId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new ApiError(500, "cap_read_failed", "Could not read daily claim cap");
  }

  const capJbm = parseNumericBigInt(row.cap_jbm);
  const distributedJbm = parseNumericBigInt(row.distributed_jbm);
  const remainingJbm = capJbm > distributedJbm ? capJbm - distributedJbm : 0n;

  return {
    cap_jbm: capJbm,
    distributed_jbm: distributedJbm,
    remaining_jbm: remainingJbm,
  };
}

function pickDefaultPayoutWallet(identity: ResolvedIdentity, requesterWallet: string): string | null {
  const normalizedRequester = normalizeAddress(requesterWallet);
  if (normalizedRequester && identity.evm_wallets.includes(normalizedRequester)) {
    return normalizedRequester;
  }
  return identity.evm_wallets[0] ?? null;
}

function claimsBelongToWallet(
  contextWallet: string | null,
  requestedWallet: string,
): boolean {
  if (!contextWallet) return false;
  return contextWallet.toLowerCase() === requestedWallet.toLowerCase();
}

function deriveIdentityFromClaims(
  requesterWallet: string,
  claims: Record<string, unknown> | null,
): {
  source: "privy" | "farcaster" | "wallet";
  value: string;
} {
  const privyUserId = claims?.sub;
  if (typeof privyUserId === "string" && privyUserId.length > 0) {
    return { source: "privy", value: privyUserId };
  }

  const fid = claims?.fid;
  if (typeof fid === "number" && Number.isFinite(fid)) {
    return { source: "farcaster", value: String(fid) };
  }

  return { source: "wallet", value: requesterWallet };
}

async function resolveIdentity(input: {
  requesterWallet: string;
  claims: Record<string, unknown> | null;
  allowClaimsEnrichment: boolean;
}): Promise<ResolvedIdentity> {
  if (input.allowClaimsEnrichment && input.claims) {
    const resolved = await resolveUserWalletMap({
      requesterWallet: input.requesterWallet,
      claims: input.claims,
      persist: true,
    });

    const identityFromClaims = deriveIdentityFromClaims(input.requesterWallet, input.claims);

    const wallets: IdentityClusterWallet[] = resolved.wallets.map((wallet) => ({
      wallet: wallet.address,
      wallet_kind: wallet.wallet_kind,
      linked_via_privy: wallet.linked_via_privy,
      linked_via_farcaster: wallet.linked_via_farcaster,
      farcaster_verified: wallet.farcaster_verified,
      is_requester_wallet: wallet.is_requester_wallet,
    }));

    return {
      identity_key: `${identityFromClaims.source}:${identityFromClaims.value}`,
      identity_source: identityFromClaims.source,
      identity_value: identityFromClaims.value,
      wallets,
      evm_wallets: [...new Set(resolved.evm_wallets)],
      solana_wallets: [...new Set(resolved.solana_wallets)],
      x_username: resolved.x_username,
      farcaster: resolved.farcaster
        ? {
            fid: resolved.farcaster.fid,
            username: resolved.farcaster.username,
            display_name: resolved.farcaster.display_name,
            pfp_url: resolved.farcaster.pfp_url,
          }
        : null,
    };
  }

  const cluster = await getIdentityClusterByWallet(input.requesterWallet);
  if (cluster) {
    return cluster;
  }

  const fallbackWallet = normalizeAddress(input.requesterWallet) ?? input.requesterWallet;
  return {
    identity_key: `wallet:${fallbackWallet}`,
    identity_source: "wallet",
    identity_value: fallbackWallet,
    wallets: [
      {
        wallet: fallbackWallet,
        wallet_kind: normalizeAddress(fallbackWallet) ? "evm" : "solana",
        linked_via_privy: false,
        linked_via_farcaster: false,
        farcaster_verified: false,
        is_requester_wallet: true,
      },
    ],
    evm_wallets: normalizeAddress(fallbackWallet) ? [fallbackWallet] : [],
    solana_wallets: normalizeAddress(fallbackWallet, "solana") ? [fallbackWallet] : [],
    x_username: null,
    farcaster: null,
  };
}

async function getCurrentAllocation(input: {
  identity: ResolvedIdentity;
  chain: "base" | "ethereum" | "solana";
  tokenAddress: string;
  periodId: number;
}): Promise<ReturnType<typeof parseAllocation>> {
  await ensureClaimRewardsTable();

  const existing = await db<ClaimAllocationRow[]>`
    SELECT
      identity_key,
      identity_source,
      identity_value,
      chain,
      token_address,
      period_id,
      heat_degrees::text AS heat_degrees,
      reward_jbm::text AS reward_jbm,
      wallets_snapshot,
      created_at::text AS created_at,
      claimed_at::text AS claimed_at,
      claimant_wallet,
      claim_nonce,
      signature,
      amount_wei::text AS amount_wei,
      deadline
    FROM ${db(CONFIG.SCHEMA)}.claim_daily_allocations
    WHERE identity_key = ${input.identity.identity_key}
      AND chain = ${input.chain}
      AND token_address = ${input.tokenAddress}
      AND period_id = ${input.periodId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return parseAllocation(existing[0]);
  }

  const walletsForHeat = input.chain === "solana"
    ? input.identity.solana_wallets
    : input.identity.evm_wallets;

  const heatBreakdown = walletsForHeat.length > 0
    ? await getWalletTokenHeats(input.tokenAddress, walletsForHeat)
    : [];

  const totalHeat = heatBreakdown.reduce((sum, row) => sum + row.heat_degrees, 0);
  const rewardJbm = BigInt(Math.max(0, Math.round(totalHeat * JBM_PER_HEAT_DEGREE)));

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.claim_daily_allocations (
      identity_key,
      identity_source,
      identity_value,
      chain,
      token_address,
      period_id,
      heat_degrees,
      reward_jbm,
      wallets_snapshot
    )
    VALUES (
      ${input.identity.identity_key},
      ${input.identity.identity_source},
      ${input.identity.identity_value},
      ${input.chain},
      ${input.tokenAddress},
      ${input.periodId},
      ${totalHeat},
      ${rewardJbm.toString()},
      ${JSON.stringify(heatBreakdown)}::jsonb
    )
    ON CONFLICT (identity_key, chain, token_address, period_id) DO NOTHING
  `;

  const inserted = await db<ClaimAllocationRow[]>`
    SELECT
      identity_key,
      identity_source,
      identity_value,
      chain,
      token_address,
      period_id,
      heat_degrees::text AS heat_degrees,
      reward_jbm::text AS reward_jbm,
      wallets_snapshot,
      created_at::text AS created_at,
      claimed_at::text AS claimed_at,
      claimant_wallet,
      claim_nonce,
      signature,
      amount_wei::text AS amount_wei,
      deadline
    FROM ${db(CONFIG.SCHEMA)}.claim_daily_allocations
    WHERE identity_key = ${input.identity.identity_key}
      AND chain = ${input.chain}
      AND token_address = ${input.tokenAddress}
      AND period_id = ${input.periodId}
    LIMIT 1
  `;

  if (inserted.length === 0) {
    throw new ApiError(500, "allocation_failed", "Could not resolve claim allocation");
  }

  return parseAllocation(inserted[0]);
}

async function getIdentityClaimEntries(input: {
  identity: ResolvedIdentity;
  periodId: number;
}) {
  const allKnownWallets = [...new Set(input.identity.wallets.map((entry) => entry.wallet))];
  const aggregated = await getAggregatedUserByWallets(allKnownWallets);
  const candidates = aggregated?.token_breakdown ?? [];

  const prepared = await Promise.all(
    candidates.map(async (entry) => {
      const chain = entry.chain ? toSupportedChain(entry.chain) : null;
      if (!chain) return null;

      const tokenAddress = normalizeAddress(entry.token, chain);
      if (!tokenAddress) return null;

      const allocation = await getCurrentAllocation({
        identity: input.identity,
        chain,
        tokenAddress,
        periodId: input.periodId,
      });

      if (allocation.reward_jbm_bigint <= 0n && getReservedJbm(allocation.amount_wei) <= 0n) {
        return null;
      }

      return {
        chain,
        tokenAddress,
        tokenName: entry.token_name,
        tokenSymbol: entry.token_symbol,
        allocation,
      };
    }),
  );

  return prepared.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );
}

claimsRoute.get("/claims/wallet/:address", async (c) => {
  const wallet =
    normalizeAddress(c.req.param("address")) ??
    normalizeAddress(c.req.param("address"), "solana");
  if (!wallet) {
    throw new ApiError(400, "invalid_wallet", "Invalid wallet address");
  }

  const contextWallet = c.get("walletAddress") ?? null;
  const rawClaims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const claims = rawClaims ?? null;

  const identity = await resolveIdentity({
    requesterWallet: wallet,
    claims,
    allowClaimsEnrichment: claimsBelongToWallet(contextWallet, wallet),
  });

  const payoutWallet = pickDefaultPayoutWallet(identity, wallet);
  const periodId = getCurrentPeriodId();
  const periodCap = await getPeriodCap(periodId);
  const claimContractAddress = getClaimContractAddress();
  const validEntries = await getIdentityClaimEntries({ identity, periodId });

  let claimedToday = validEntries.some((entry) => Boolean(entry.allocation.claimed_at));
  if (claimContractAddress && payoutWallet && validEntries.length > 0) {
    try {
      claimedToday = await readOnchainClaimStatus({
        claimContractAddress,
        periodId,
        payoutWallet,
      });
    } catch {
      claimedToday = validEntries.some((entry) => Boolean(entry.allocation.claimed_at));
    }
  }

  const claimedStatuses = validEntries.map(() => claimedToday);

  const items = validEntries
    .map((entry, index) => {
      const claimedToday = claimedStatuses[index] ?? false;
      const reservedJbm = getReservedJbm(entry.allocation.amount_wei);
      const claimableJbm = claimedToday
        ? 0n
        : reservedJbm > 0n
          ? reservedJbm
          : entry.allocation.reward_jbm_bigint;

      return {
        chain: entry.chain,
        token_address: entry.tokenAddress,
        token_name: entry.tokenName,
        token_symbol: entry.tokenSymbol,
        heat_degrees: Number(entry.allocation.heat_degrees_number.toFixed(2)),
        claimable_jbm: claimableJbm.toString(),
        claimable_wei: (claimableJbm * WEI_PER_JBM).toString(),
        can_claim: Boolean(payoutWallet && claimableJbm > 0n && !claimedToday),
        claimed_today: claimedToday,
        last_claimed_at: claimedToday ? entry.allocation.claimed_at : null,
        claim_nonce: entry.allocation.claim_nonce,
        has_reservation: reservedJbm > 0n,
        deadline:
          entry.allocation.deadline !== null
            ? String(entry.allocation.deadline)
            : null,
      };
    })
    .filter((entry) => entry.can_claim || entry.claimed_today)
    .sort((a, b) => {
      if (a.claim_nonce !== null && b.claim_nonce !== null) {
        return a.claim_nonce - b.claim_nonce;
      }
      if (a.claim_nonce !== null) return -1;
      if (b.claim_nonce !== null) return 1;
      return b.heat_degrees - a.heat_degrees;
    });

  const claimableItems = items.filter((entry) => entry.can_claim);
  const totalClaimableJbm = claimableItems.reduce(
    (sum, entry) => sum + parseNumericBigInt(entry.claimable_jbm),
    0n,
  );

  return c.json({
    payout_wallet: payoutWallet,
    period_id: periodId,
    period_start_at: getPeriodStartIso(periodId),
    period_end_at: getPeriodEndIso(periodId),
    claimable_count: claimableItems.length,
    total_claimable_jbm: totalClaimableJbm.toString(),
    daily_cap_jbm: periodCap.cap_jbm.toString(),
    daily_distributed_jbm: periodCap.distributed_jbm.toString(),
    daily_remaining_jbm: periodCap.remaining_jbm.toString(),
    items,
  });
});

claimsRoute.get("/claims/:chain/:ca/:address", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const wallet =
    normalizeAddress(c.req.param("address"), chain) ??
    normalizeAddress(c.req.param("address"));
  if (!wallet) {
    throw new ApiError(400, "invalid_wallet", "Invalid wallet address");
  }

  const contextWallet = c.get("walletAddress") ?? null;
  const rawClaims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const claims = rawClaims ?? null;

  const identity = await resolveIdentity({
    requesterWallet: wallet,
    claims,
    allowClaimsEnrichment: claimsBelongToWallet(contextWallet, wallet),
  });

  const periodId = getCurrentPeriodId();
  const allocation = await getCurrentAllocation({
    identity,
    chain,
    tokenAddress,
    periodId,
  });
  const periodCap = await getPeriodCap(periodId);

  const payoutWallet = pickDefaultPayoutWallet(identity, wallet);
  const claimContractAddress = getClaimContractAddress();
  let claimedToday = Boolean(allocation.claimed_at);

  if (claimContractAddress && payoutWallet) {
    try {
      claimedToday = await readOnchainClaimStatus({
        claimContractAddress,
        periodId,
        payoutWallet,
      });
    } catch {
      claimedToday = Boolean(allocation.claimed_at);
    }
  }

  const reservedJbm = getReservedJbm(allocation.amount_wei);
  const effectiveClaimableJbm = reservedJbm > 0n
    ? reservedJbm
    : minBigInt(allocation.reward_jbm_bigint, periodCap.remaining_jbm);
  const canClaim = Boolean(
    payoutWallet &&
    effectiveClaimableJbm > 0n &&
    !claimedToday,
  );

  return c.json({
    heat_degrees: Number(allocation.heat_degrees_number.toFixed(2)),
    claimable_jbm: canClaim ? effectiveClaimableJbm.toString() : "0",
    claimable_wei: canClaim
      ? parseUnits(effectiveClaimableJbm.toString(), 18).toString()
      : "0",
    last_claimed_at: claimedToday ? allocation.claimed_at : null,
    can_claim: canClaim,
    claimed_today: claimedToday,
    payout_wallet: payoutWallet,
    daily_cap_jbm: periodCap.cap_jbm.toString(),
    daily_distributed_jbm: periodCap.distributed_jbm.toString(),
    daily_remaining_jbm: periodCap.remaining_jbm.toString(),
    period_id: periodId,
    period_start_at: getPeriodStartIso(periodId),
    period_end_at: getPeriodEndIso(periodId),
    identity_key: identity.identity_key,
    identity_source: identity.identity_source,
    x_username: identity.x_username,
    farcaster: identity.farcaster,
    wallet_map: identity.wallets,
    wallet_map_summary: {
      total_wallets: identity.wallets.length,
      evm_wallets: identity.evm_wallets.length,
      solana_wallets: identity.solana_wallets.length,
      farcaster_verified_wallets: identity.wallets.filter((entry) => entry.farcaster_verified).length,
    },
    holdings: allocation.wallets_snapshot_parsed,
  });
});

claimsRoute.post("/claims/:chain/:ca/sign", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const body = await c.req.json<{
    wallet?: unknown;
    payout_wallet?: unknown;
  }>();

  const contextWallet = c.get("walletAddress") ?? null;
  const requesterWallet =
    (typeof body.wallet === "string"
      ? normalizeAddress(body.wallet) ?? normalizeAddress(body.wallet, "solana")
      : null) ??
    (contextWallet ? normalizeAddress(contextWallet) ?? normalizeAddress(contextWallet, "solana") : null);

  if (!requesterWallet) {
    throw new ApiError(
      400,
      "invalid_wallet",
      "wallet must be provided or authenticated",
    );
  }

  const rawClaims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const claims = rawClaims ?? null;

  const identity = await resolveIdentity({
    requesterWallet,
    claims,
    allowClaimsEnrichment: claimsBelongToWallet(contextWallet, requesterWallet),
  });

  const requestedPayoutWallet =
    typeof body.payout_wallet === "string"
      ? normalizeAddress(body.payout_wallet)
      : null;

  const payoutWallet = requestedPayoutWallet ?? pickDefaultPayoutWallet(identity, requesterWallet);
  if (!payoutWallet) {
    throw new ApiError(
      400,
      "missing_evm_wallet",
      "No EVM wallet found for payouts. Link an EVM wallet in Privy/Farcaster.",
    );
  }

  if (!identity.evm_wallets.includes(payoutWallet)) {
    throw new ApiError(
      403,
      "invalid_payout_wallet",
      "Payout wallet is not part of this identity",
    );
  }

  const periodId = getCurrentPeriodId();
  const claimEntries = await getIdentityClaimEntries({ identity, periodId });
  if (claimEntries.length === 0) {
    throw new ApiError(409, "nothing_to_claim", "No claimable JBM for this period");
  }
  const entryMetaByKey = new Map(
    claimEntries.map((entry) => [
      `${entry.chain}:${entry.tokenAddress.toLowerCase()}`,
      {
        token_name: entry.tokenName,
        token_symbol: entry.tokenSymbol,
      },
    ]),
  );

  const privateKey = CONFIG.CLAIM_SIGNER_PRIVATE_KEY.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new ApiError(
      500,
      "claim_signer_not_configured",
      "CLAIM_SIGNER_PRIVATE_KEY is not configured",
    );
  }

  const claimContractAddress = getClaimContractAddress();
  if (!claimContractAddress) {
    throw new ApiError(
      500,
      "claim_contract_not_configured",
      "CLAIM_CONTRACT_ADDRESS is not configured",
    );
  }

  const tokenAddressForClaim = normalizeAddress(CONFIG.JBM_TOKEN_ADDRESS);
  if (!tokenAddressForClaim) {
    throw new ApiError(
      500,
      "jbm_token_not_configured",
      "JBM_TOKEN_ADDRESS is not configured",
    );
  }

  const escrowAddress = normalizeAddress(CONFIG.TREASURY_ADDRESS);
  if (!escrowAddress) {
    throw new ApiError(
      500,
      "treasury_not_configured",
      "TREASURY_ADDRESS is not configured",
    );
  }

  let claimedToday = claimEntries.some((entry) => Boolean(entry.allocation.claimed_at));
  let onchainNonce = 0;

  // Nonce must come from chain to avoid signing with stale local reservations.
  try {
    onchainNonce = await readOnchainClaimNonceWithRetry({
      claimContractAddress,
      payoutWallet,
      retries: 2,
    });
  } catch {
    throw new ApiError(
      503,
      "nonce_unavailable",
      "Could not read onchain claim nonce. Please retry in a few seconds.",
    );
  }

  // Claimed status can safely fall back to DB if the read path is temporarily unavailable.
  try {
    claimedToday = await readOnchainClaimStatus({
      claimContractAddress,
      periodId,
      payoutWallet,
    });
  } catch {
    claimedToday = claimEntries.some((entry) => Boolean(entry.allocation.claimed_at));
  }

  if (claimedToday) {
    throw new ApiError(409, "already_claimed_today", "Daily reward already claimed");
  }

  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  const response = await db.begin(async (tx) => {
    const trx = tx as unknown as typeof db;

    await trx`SELECT pg_advisory_xact_lock(hashtext(${`claim-period-total:${payoutWallet}:${periodId}`}))`;

    await trx`
      INSERT INTO ${db(CONFIG.SCHEMA)}.claim_period_caps (
        period_id,
        cap_jbm,
        distributed_jbm
      )
      VALUES (
        ${periodId},
        ${DAILY_DISTRIBUTION_CAP_JBM.toString()},
        0
      )
      ON CONFLICT (period_id) DO NOTHING
    `;

    const capRows = await trx<ClaimPeriodCapRow[]>`
      SELECT
        period_id,
        cap_jbm::text AS cap_jbm,
        distributed_jbm::text AS distributed_jbm,
        updated_at::text AS updated_at
      FROM ${db(CONFIG.SCHEMA)}.claim_period_caps
      WHERE period_id = ${periodId}
      FOR UPDATE
    `;

    const capRow = capRows[0];
    if (!capRow) {
      throw new ApiError(500, "cap_read_failed", "Could not read daily claim cap");
    }

    const capJbm = parseNumericBigInt(capRow.cap_jbm);
    const distributedJbm = parseNumericBigInt(capRow.distributed_jbm);
    let distributedAfter = distributedJbm;
    let remainingAfter = capJbm > distributedJbm ? capJbm - distributedJbm : 0n;

    const allocationRows = await trx<ClaimAllocationRow[]>`
      SELECT
        identity_key,
        identity_source,
        identity_value,
        chain,
        token_address,
        period_id,
        heat_degrees::text AS heat_degrees,
        reward_jbm::text AS reward_jbm,
        wallets_snapshot,
        created_at::text AS created_at,
        claimed_at::text AS claimed_at,
        claimant_wallet,
        claim_nonce,
        signature,
        amount_wei::text AS amount_wei,
        deadline
      FROM ${db(CONFIG.SCHEMA)}.claim_daily_allocations
      WHERE identity_key = ${identity.identity_key}
        AND period_id = ${periodId}
      FOR UPDATE
    `;

    if (allocationRows.length === 0) {
      throw new ApiError(500, "allocation_failed", "Could not resolve claim allocation");
    }

    const lockedAllocations = allocationRows
      .map((row) => parseAllocation(row))
      .filter((row) => row.reward_jbm_bigint > 0n || getReservedJbm(row.amount_wei) > 0n)
      .sort((a, b) => {
        const keyA = `${a.chain}:${a.token_address}`;
        const keyB = `${b.chain}:${b.token_address}`;
        return keyA.localeCompare(keyB);
      });

    if (lockedAllocations.length === 0) {
      throw new ApiError(409, "nothing_to_claim", "No claimable JBM for this period");
    }

    const grantedRows: Array<{
      chain: "base" | "ethereum" | "solana";
      token_address: string;
      granted_jbm: bigint;
      amount_wei: bigint;
      heat_degrees: number;
    }> = [];

    for (const row of lockedAllocations) {
      const hasReservedAmount = parseNumericBigInt(row.amount_wei) > 0n;
      const grantedJbm = hasReservedAmount
        ? getReservedJbm(row.amount_wei)
        : minBigInt(row.reward_jbm_bigint, remainingAfter);

      if (grantedJbm <= 0n) continue;

      if (!hasReservedAmount) {
        distributedAfter += grantedJbm;
        remainingAfter = capJbm > distributedAfter ? capJbm - distributedAfter : 0n;
      }

      grantedRows.push({
        chain: row.chain,
        token_address: row.token_address,
        granted_jbm: grantedJbm,
        amount_wei: parseUnits(grantedJbm.toString(), 18),
        heat_degrees: Number(row.heat_degrees_number.toFixed(2)),
      });
    }

    if (grantedRows.length === 0) {
      throw new ApiError(409, "daily_cap_reached", "Daily claim cap reached");
    }

    if (distributedAfter !== distributedJbm) {
      await trx`
        UPDATE ${db(CONFIG.SCHEMA)}.claim_period_caps
        SET
          distributed_jbm = ${distributedAfter.toString()},
          updated_at = NOW()
        WHERE period_id = ${periodId}
      `;
    }

    const totalGrantedJbm = grantedRows.reduce((sum, row) => sum + row.granted_jbm, 0n);
    const amountInWei = parseUnits(totalGrantedJbm.toString(), 18);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const breakdownPayload = JSON.stringify({
      version: 1,
      period_id: periodId,
      identity_key: identity.identity_key,
      payout_wallet: payoutWallet,
      total_jbm: totalGrantedJbm.toString(),
      items: grantedRows.map((row) => {
        const key = `${row.chain}:${row.token_address.toLowerCase()}`;
        const meta = entryMetaByKey.get(key);
        return {
          chain: row.chain,
          token_address: row.token_address,
          token_name: meta?.token_name ?? null,
          token_symbol: meta?.token_symbol ?? null,
          heat_degrees: row.heat_degrees,
          amount_jbm: row.granted_jbm.toString(),
          amount_wei: row.amount_wei.toString(),
        };
      }),
    });
    const breakdownHash = keccak256(stringToHex(breakdownPayload));
    const nonce = onchainNonce;

    const signature = await signer.signTypedData({
      domain: {
        name: "JBMClaimEscrowV8",
        version: "1",
        chainId: 8453,
        verifyingContract: claimContractAddress as `0x${string}`,
      },
      types: {
        BatchTotalClaim: [
          { name: "token", type: "address" },
          { name: "escrow", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "periodId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "breakdownHash", type: "bytes32" },
        ],
      },
      primaryType: "BatchTotalClaim",
      message: {
        token: tokenAddressForClaim as `0x${string}`,
        escrow: escrowAddress as `0x${string}`,
        recipient: payoutWallet as `0x${string}`,
        amount: amountInWei,
        periodId: BigInt(periodId),
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
        breakdownHash,
      },
    });

    // Validate the generated payload against the contract before returning it.
    try {
      await publicClients.base.simulateContract({
        address: claimContractAddress,
        abi: CLAIM_ESCROW_ABI,
        functionName: "claimPeriodTotal",
        args: [
          escrowAddress as `0x${string}`,
          payoutWallet as `0x${string}`,
          amountInWei,
          BigInt(periodId),
          BigInt(deadline),
          breakdownHash,
          signature,
        ],
        account: payoutWallet as `0x${string}`,
      });
    } catch (error) {
      const reason = extractRevertReason(error);
      throw new ApiError(
        500,
        "claim_signature_preflight_failed",
        reason
          ? `Claim payload preflight failed: ${reason}`
          : "Claim payload preflight failed",
      );
    }

    for (const row of grantedRows) {
      await trx`
        UPDATE ${db(CONFIG.SCHEMA)}.claim_daily_allocations
        SET
          claimed_at = NULL,
          claimant_wallet = ${payoutWallet},
          claim_nonce = ${nonce},
          signature = ${signature},
          amount_wei = ${row.amount_wei.toString()},
          deadline = ${deadline}
        WHERE identity_key = ${identity.identity_key}
          AND chain = ${row.chain}
          AND token_address = ${row.token_address}
          AND period_id = ${periodId}
      `;
    }

    return {
      signature,
      claim_contract: claimContractAddress,
      escrow: escrowAddress,
      amount_jbm: totalGrantedJbm.toString(),
      amount_wei: amountInWei.toString(),
      periodId: periodId.toString(),
      nonce,
      deadline: String(deadline),
      breakdown_hash: breakdownHash,
      signerAddress: signer.address,
      payout_wallet: payoutWallet,
      identity_key: identity.identity_key,
      identity_source: identity.identity_source,
      daily_cap_jbm: capJbm.toString(),
      daily_distributed_jbm: distributedAfter.toString(),
      daily_remaining_jbm: remainingAfter.toString(),
    };
  });

  return c.json(response);
});

claimsRoute.post("/claims/:chain/:ca/confirm", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const body = await c.req.json<{
    wallet?: unknown;
    payout_wallet?: unknown;
  }>();

  const contextWallet = c.get("walletAddress") ?? null;
  const requesterWallet =
    (typeof body.wallet === "string"
      ? normalizeAddress(body.wallet) ?? normalizeAddress(body.wallet, "solana")
      : null) ??
    (contextWallet ? normalizeAddress(contextWallet) ?? normalizeAddress(contextWallet, "solana") : null);

  if (!requesterWallet) {
    throw new ApiError(
      400,
      "invalid_wallet",
      "wallet must be provided or authenticated",
    );
  }

  const rawClaims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const claims = rawClaims ?? null;

  const identity = await resolveIdentity({
    requesterWallet,
    claims,
    allowClaimsEnrichment: claimsBelongToWallet(contextWallet, requesterWallet),
  });

  const requestedPayoutWallet =
    typeof body.payout_wallet === "string"
      ? normalizeAddress(body.payout_wallet)
      : null;
  const payoutWallet = requestedPayoutWallet ?? pickDefaultPayoutWallet(identity, requesterWallet);

  if (!payoutWallet) {
    throw new ApiError(
      400,
      "missing_evm_wallet",
      "No EVM wallet found for payouts. Link an EVM wallet in Privy/Farcaster.",
    );
  }

  if (!identity.evm_wallets.includes(payoutWallet)) {
    throw new ApiError(
      403,
      "invalid_payout_wallet",
      "Payout wallet is not part of this identity",
    );
  }

  const claimContractAddress = getClaimContractAddress();
  if (!claimContractAddress) {
    throw new ApiError(
      500,
      "claim_contract_not_configured",
      "CLAIM_CONTRACT_ADDRESS is not configured",
    );
  }

  const periodId = getCurrentPeriodId();
  const claimedToday = await readOnchainClaimStatus({
    claimContractAddress,
    periodId,
    payoutWallet,
  });

  if (!claimedToday) {
    throw new ApiError(409, "claim_pending", "Claim is not confirmed onchain yet");
  }

  const rows = await db<Array<{ claimed_at: string }>>`
    UPDATE ${db(CONFIG.SCHEMA)}.claim_daily_allocations
    SET
      claimed_at = COALESCE(claimed_at, NOW()),
      claimant_wallet = ${payoutWallet}
    WHERE identity_key = ${identity.identity_key}
      AND period_id = ${periodId}
    RETURNING claimed_at::text AS claimed_at
  `;

  if (rows.length === 0) {
    throw new ApiError(404, "allocation_not_found", "Claim allocation not found");
  }

  return c.json({
    ok: true,
    claimed_at: rows[0].claimed_at,
    payout_wallet: payoutWallet,
    period_id: periodId,
  });
});

export default claimsRoute;
