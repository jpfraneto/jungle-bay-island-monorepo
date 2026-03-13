import { Hono } from "hono";
import { normalizeAddress } from "../config";
import { optionalWalletContext, requirePrivyAuth } from "../middleware/auth";
import { ApiError } from "../services/errors";
import { recordOnchainInteraction } from "../services/interactionLedger";
import {
  buildDailyClaimSignature,
  buildLinkWalletSignature,
  buildMintQuoteSignature,
  buildRegisterSignature,
  buildSyncHeatSignature,
  confirmTrackedTransaction,
  getCommissionDetail,
  getCommissionList,
  getOnchainMe,
  listBodegaItems,
  ONCHAIN_CONTRACTS,
  resolveBungalowByAsset,
  resolveSessionIdentity,
} from "../services/onchain";
import type { AppEnv } from "../types";

const onchainRoute = new Hono<AppEnv>();

onchainRoute.use("/onchain/*", optionalWalletContext);

function getPrivyContext(c: any) {
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  if (!privyUserId) {
    throw new ApiError(401, "auth_required", "Privy authentication required");
  }
  return { privyUserId, claims };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalInt(value: string | null | undefined): number | null {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asBodyInt(value: unknown, fieldName: string): number {
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "invalid_input", `${fieldName} must be a positive integer`);
  }
  return parsed;
}

function asHexTxHash(value: unknown): string {
  const txHash = asString(value).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    throw new ApiError(400, "invalid_tx_hash", "tx_hash must be a valid transaction hash");
  }
  return txHash;
}

onchainRoute.get("/onchain/me", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  return c.json(await getOnchainMe(context));
});

onchainRoute.post("/onchain/register/sign", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const session = await resolveSessionIdentity(context);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));

  if (session.profileId) {
    throw new ApiError(409, "profile_exists", "This session already has an onchain profile");
  }

  return c.json(await buildRegisterSignature({ wallet, session }));
});

onchainRoute.post("/onchain/link-wallet/sign", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const session = await resolveSessionIdentity(context);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));

  return c.json(await buildLinkWalletSignature({ wallet, session }));
});

onchainRoute.post("/onchain/bungalows/:bungalowId/sync-heat/sign", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const session = await resolveSessionIdentity(context);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));
  const bungalowId = asBodyInt(c.req.param("bungalowId"), "bungalowId");

  return c.json(await buildSyncHeatSignature({ bungalowId, wallet, session }));
});

onchainRoute.post("/onchain/claim-daily/sign", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const session = await resolveSessionIdentity(context);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));

  return c.json(await buildDailyClaimSignature({ wallet, session }));
});

onchainRoute.post("/onchain/bungalows/mint-quote", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const session = await resolveSessionIdentity(context);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));
  const chain = asString(body.chain);
  const tokenAddress = asString(body.token_address ?? body.tokenAddress);

  if (!chain || !tokenAddress) {
    throw new ApiError(400, "invalid_input", "chain and token_address are required");
  }

  return c.json(await buildMintQuoteSignature({ wallet, chain, tokenAddress, session }));
});

onchainRoute.get("/onchain/contracts", async (c) => {
  return c.json({ contracts: ONCHAIN_CONTRACTS });
});

onchainRoute.get("/onchain/bungalows/:chain/:tokenAddress", async (c) => {
  const chain = asString(c.req.param("chain"));
  const tokenAddress = asString(c.req.param("tokenAddress"));
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const session = privyUserId ? await resolveSessionIdentity({ privyUserId, claims }) : null;

  return c.json(await resolveBungalowByAsset({ chain, tokenAddress, session }));
});

onchainRoute.get("/onchain/bodega/items", async (c) => {
  const bungalowId = asOptionalInt(c.req.query("bungalow_id"));
  const creatorProfileId = asOptionalInt(c.req.query("creator_profile_id"));
  const limit = asOptionalInt(c.req.query("limit")) ?? 48;

  return c.json({
    items: await listBodegaItems({
      bungalowId,
      creatorProfileId,
      limit,
    }),
  });
});

onchainRoute.get("/onchain/commissions", async (c) => {
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const session = privyUserId ? await resolveSessionIdentity({ privyUserId, claims }) : null;

  return c.json(
    await getCommissionList({
      scope: c.req.query("scope"),
      session,
      limit: asOptionalInt(c.req.query("limit")) ?? 48,
    }),
  );
});

onchainRoute.get("/onchain/commissions/:commissionId", async (c) => {
  const commissionId = asBodyInt(c.req.param("commissionId"), "commissionId");
  const privyUserId = c.get("privyUserId") as string | undefined;
  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const session = privyUserId ? await resolveSessionIdentity({ privyUserId, claims }) : null;

  return c.json(await getCommissionDetail({ commissionId, session }));
});

onchainRoute.post("/onchain/txs", requirePrivyAuth, async (c) => {
  const context = getPrivyContext(c);
  const body = asObject(await c.req.json().catch(() => null));
  const txHash = asHexTxHash(body.tx_hash ?? body.txHash);
  const wallet = asString(body.wallet ?? c.get("walletAddress"));
  const contractAddress = asString(body.contract_address ?? body.contractAddress);

  if (wallet) {
    const normalizedWallet = normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana");
    if (!normalizedWallet) {
      throw new ApiError(400, "invalid_wallet", "wallet must be a valid address");
    }
  }

  await recordOnchainInteraction({
    txHash,
    chainId: ONCHAIN_CONTRACTS.chainId,
    contractAddress: contractAddress || null,
    action: asString(body.action) || "write",
    functionName: asString(body.function_name ?? body.functionName) || null,
    chain: asString(body.chain) || ONCHAIN_CONTRACTS.chain,
    tokenAddress: asString(body.token_address ?? body.tokenAddress) || null,
    privyUserId: context.privyUserId,
    wallet: wallet || null,
    profileId: asOptionalInt(asString(body.profile_id ?? body.profileId)),
    bungalowId: asOptionalInt(asString(body.bungalow_id ?? body.bungalowId)),
    itemId: asOptionalInt(asString(body.item_id ?? body.itemId)),
    commissionId: asOptionalInt(asString(body.commission_id ?? body.commissionId)),
    applicationId: asOptionalInt(asString(body.application_id ?? body.applicationId)),
    status: "submitted",
    metadata: asObject(body.metadata),
  });

  return c.json({
    ok: true,
    tx_hash: txHash,
    status: "submitted",
  });
});

onchainRoute.post("/onchain/txs/:txHash/confirm", requirePrivyAuth, async (c) => {
  const txHash = asHexTxHash(c.req.param("txHash"));
  return c.json(await confirmTrackedTransaction({ txHash }));
});

export default onchainRoute;
