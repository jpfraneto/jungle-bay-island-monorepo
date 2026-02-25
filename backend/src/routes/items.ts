import { Hono } from "hono";
import { CONFIG, db, normalizeAddress, toSupportedChain } from "../config";
import { ApiError } from "../services/errors";
import type { AppEnv } from "../types";

const itemsRoute = new Hono<AppEnv>();

const ITEM_PRICES: Record<"link" | "frame" | "image" | "portal", bigint> = {
  link: 69_000n,
  frame: 50_000n,
  image: 250_000n,
  portal: 1_000_000n,
};

interface BungalowItemRow {
  id: number;
  token_address: string;
  chain: string;
  item_type: "link" | "frame" | "image" | "portal";
  content: unknown;
  placed_by: string;
  tx_hash: string;
  jbm_amount: string;
  created_at: string;
}

function parseJbmAmount(input: unknown): bigint | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const raw = String(input).trim();
  if (!/^\d+$/.test(raw)) return null;

  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

itemsRoute.get("/bungalow/:chain/:ca/items", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const rows = await db<BungalowItemRow[]>`
    SELECT
      id,
      token_address,
      chain,
      item_type,
      content,
      placed_by,
      tx_hash,
      jbm_amount::text AS jbm_amount,
      created_at::text AS created_at
    FROM ${db(CONFIG.SCHEMA)}.bungalow_items
    WHERE token_address = ${tokenAddress} AND chain = ${chain}
    ORDER BY created_at DESC, id DESC
  `;

  return c.json({ items: rows });
});

itemsRoute.post("/bungalow/:chain/:ca/items", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const body = await c.req.json<{
    item_type?: unknown;
    content?: unknown;
    placed_by?: unknown;
    tx_hash?: unknown;
    jbm_amount?: unknown;
  }>();

  const itemType = typeof body.item_type === "string" ? body.item_type.trim().toLowerCase() : "";
  if (!(itemType in ITEM_PRICES)) {
    throw new ApiError(
      400,
      "invalid_item_type",
      "item_type must be one of: link, image, frame, portal",
    );
  }

  const content = body.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new ApiError(400, "invalid_content", "content must be a JSON object");
  }

  const placedByRaw = typeof body.placed_by === "string" ? body.placed_by.trim() : "";
  if (!placedByRaw) {
    throw new ApiError(400, "invalid_placed_by", "placed_by is required");
  }

  const placedBy = normalizeAddress(placedByRaw, chain) ?? normalizeAddress(placedByRaw);
  if (!placedBy) {
    throw new ApiError(400, "invalid_placed_by", "placed_by must be a valid wallet address");
  }

  const txHash = typeof body.tx_hash === "string" ? body.tx_hash.trim() : "";
  if (!txHash) {
    throw new ApiError(400, "invalid_tx_hash", "tx_hash is required");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, "invalid_tx_hash", "tx_hash must be a valid transaction hash");
  }

  const parsedAmount = parseJbmAmount(body.jbm_amount);
  if (parsedAmount === null) {
    throw new ApiError(400, "invalid_jbm_amount", "jbm_amount must be a numeric string");
  }

  const expectedAmount = ITEM_PRICES[itemType as keyof typeof ITEM_PRICES];
  if (parsedAmount !== expectedAmount) {
    throw new ApiError(
      400,
      "invalid_item_price",
      `Invalid JBM amount for ${itemType}. Expected ${expectedAmount.toString()}`,
    );
  }

  const existing = await db<Array<{ id: number }>>`
    SELECT id
    FROM ${db(CONFIG.SCHEMA)}.bungalow_items
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `;
  if (existing.length > 0) {
    throw new ApiError(409, "duplicate_tx_hash", "tx_hash has already been used");
  }

  const rows = await db<BungalowItemRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_items (
      token_address,
      chain,
      item_type,
      content,
      placed_by,
      tx_hash,
      jbm_amount
    )
    VALUES (
      ${tokenAddress},
      ${chain},
      ${itemType},
      ${JSON.stringify(content)}::jsonb,
      ${placedBy},
      ${txHash},
      ${parsedAmount.toString()}
    )
    RETURNING
      id,
      token_address,
      chain,
      item_type,
      content,
      placed_by,
      tx_hash,
      jbm_amount::text AS jbm_amount,
      created_at::text AS created_at
  `;

  return c.json({ item: rows[0] }, 201);
});

export default itemsRoute;
