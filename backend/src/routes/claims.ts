import { Hono } from "hono";
import { encodePacked, keccak256, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONFIG, db, normalizeAddress, toSupportedChain } from "../config";
import { getWalletTokenHeat } from "../db/queries";
import { ApiError } from "../services/errors";
import type { AppEnv } from "../types";

const claimsRoute = new Hono<AppEnv>();

interface ClaimHistoryRow {
  amount: string;
  nonce: number;
  claimed_at: string;
  claimed_today: boolean;
}

function buildBungalowId(chain: string, tokenAddress: string): `0x${string}` {
  return keccak256(encodePacked(["string", "string"], [chain, tokenAddress]));
}

function getCurrentPeriodId(): number {
  return Math.floor(Date.now() / 1000 / 86400);
}

async function getLastClaim(
  wallet: string,
  bungalowId: `0x${string}`,
  periodId: number,
): Promise<ClaimHistoryRow | null> {
  const rows = await db<ClaimHistoryRow[]>`
    SELECT
      amount::text AS amount,
      nonce,
      claimed_at::text AS claimed_at,
      TRUE AS claimed_today
    FROM ${db(CONFIG.SCHEMA)}.claim_history
    WHERE wallet = ${wallet}
      AND bungalow_id = ${bungalowId}
      AND period_id = ${periodId}
    ORDER BY claimed_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function getNextNonce(wallet: string): Promise<number> {
  const rows = await db<Array<{ max_nonce: number | null }>>`
    SELECT MAX(nonce) AS max_nonce
    FROM ${db(CONFIG.SCHEMA)}.claim_history
    WHERE wallet = ${wallet}
  `;

  return Number(rows[0]?.max_nonce ?? 0) + 1;
}

async function computeClaimState(input: {
  chain: string;
  tokenAddress: string;
  wallet: string;
  periodId?: number;
}) {
  const heatDegrees = await getWalletTokenHeat(
    input.tokenAddress,
    input.wallet,
  );
  const heat = heatDegrees ?? 0;
  const claimableFromHeat = BigInt(Math.max(0, Math.round(heat * 100)));
  const bungalowId = buildBungalowId(input.chain, input.tokenAddress);
  const periodId = input.periodId ?? getCurrentPeriodId();

  const lastClaim = await getLastClaim(input.wallet, bungalowId, periodId);
  const claimedToday = Boolean(lastClaim?.claimed_today);
  const claimable = claimedToday ? 0n : claimableFromHeat;

  return {
    heat_degrees: Math.round(heat * 100) / 100,
    claimable_jbm: claimable.toString(),
    last_claimed_at: lastClaim?.claimed_at ?? null,
    can_claim: claimable > 0n,
    claimed_today: claimedToday,
  };
}

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

  const claimState = await computeClaimState({
    chain,
    tokenAddress,
    wallet,
  });

  return c.json(claimState);
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

  const body = await c.req.json<{ wallet?: unknown }>();

  const wallet =
    typeof body.wallet === "string" ? normalizeAddress(body.wallet) : null;
  if (!wallet) {
    throw new ApiError(
      400,
      "invalid_wallet",
      "wallet must be a valid EVM address",
    );
  }
  const bungalowId = buildBungalowId(chain, tokenAddress);
  const periodIdNumber = getCurrentPeriodId();
  const periodId = BigInt(periodIdNumber);

  const claimState = await computeClaimState({
    chain,
    tokenAddress,
    wallet,
    periodId: periodIdNumber,
  });

  const claimable = BigInt(claimState.claimable_jbm);
  if (!claimState.can_claim || claimable <= 0n) {
    throw new ApiError(
      409,
      "already_claimed_today",
      "No claimable JBM available",
    );
  }

  const privateKey = CONFIG.CLAIM_SIGNER_PRIVATE_KEY.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new ApiError(
      500,
      "claim_signer_not_configured",
      "CLAIM_SIGNER_PRIVATE_KEY is not configured",
    );
  }

  const claimContractAddress = normalizeAddress(CONFIG.CLAIM_CONTRACT_ADDRESS);
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

  const nonce = await getNextNonce(wallet);
  const amountInWei = parseUnits(claimable.toString(), 18);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  const signature = await signer.signTypedData({
    domain: {
      name: "JBMClaimEscrow",
      version: "1",
      chainId: 8453,
      verifyingContract: claimContractAddress as `0x${string}`,
    },
    types: {
      Claim: [
        { name: "token", type: "address" },
        { name: "escrow", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "bungalowId", type: "bytes32" },
        { name: "periodId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: {
      token: tokenAddressForClaim as `0x${string}`,
      escrow: escrowAddress as `0x${string}`,
      recipient: wallet as `0x${string}`,
      amount: amountInWei,
      bungalowId,
      periodId,
      nonce: BigInt(nonce),
      deadline,
    },
  });

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.claim_history (
      wallet,
      token_address,
      chain,
      bungalow_id,
      period_id,
      amount,
      nonce,
      signature
    )
    VALUES (
      ${wallet},
      ${tokenAddress},
      ${chain},
      ${bungalowId},
      ${periodIdNumber},
      ${amountInWei.toString()},
      ${nonce},
      ${signature}
    )
  `;

  return c.json({
    signature,
    escrow: escrowAddress,
    amount: amountInWei.toString(),
    bungalowId,
    periodId: periodId.toString(),
    nonce,
    deadline: deadline.toString(),
    signerAddress: signer.address,
  });
});

export default claimsRoute;
