import { Hono } from "hono";
import { CONFIG, db, normalizeAddress, toSupportedChain } from "../config";
import { userOwnsWallet } from "../db/queries";
import { requirePrivyAuth } from "../middleware/auth";
import {
  getCanonicalProjectContext,
  type CanonicalDeploymentRef,
} from "../services/canonicalProjects";
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
  placed_by_heat_degrees: string | null;
  tx_hash: string;
  jbm_amount: string;
  created_at: string;
}

interface AddressContributionRow extends BungalowItemRow {
  bungalow_name: string | null;
  bungalow_symbol: string | null;
  bungalow_image_url: string | null;
}

let bungalowItemsTablePromise: Promise<void> | null = null;

async function ensureBungalowItemsTable(): Promise<void> {
  if (!bungalowItemsTablePromise) {
    bungalowItemsTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_items (
          id SERIAL PRIMARY KEY,
          token_address TEXT NOT NULL,
          chain TEXT NOT NULL,
          item_type TEXT NOT NULL CHECK (item_type IN ('link', 'image', 'frame', 'portal')),
          content JSONB NOT NULL,
          placed_by TEXT NOT NULL,
          tx_hash TEXT UNIQUE NOT NULL,
          jbm_amount NUMERIC NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_items_token
        ON ${db(CONFIG.SCHEMA)}.bungalow_items(token_address, chain, created_at DESC)
      `;

      await db`
        CREATE INDEX IF NOT EXISTS idx_bungalow_items_placed_by
        ON ${db(CONFIG.SCHEMA)}.bungalow_items(placed_by)
      `;
    })();
  }

  await bungalowItemsTablePromise;
}

function buildDeploymentWhereClause(
  alias: string,
  deployments: CanonicalDeploymentRef[],
): { clause: string; params: string[] } {
  const params: string[] = [];
  const clause = deployments
    .map((deployment) => {
      const tokenParam = params.push(deployment.token_address);
      const chainParam = params.push(deployment.chain);
      return `(${alias}.token_address = $${tokenParam} AND ${alias}.chain = $${chainParam})`;
    })
    .join(" OR ");

  return {
    clause: clause || "FALSE",
    params,
  };
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

function getPrivyUserIdFromClaims(claims: Record<string, unknown> | undefined): string {
  const privyUserId = typeof claims?.sub === "string" ? claims.sub.trim() : "";
  if (!privyUserId) {
    throw new ApiError(401, "auth_required", "Privy authentication required");
  }
  return privyUserId;
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeItemContent(
  itemType: keyof typeof ITEM_PRICES,
  input: unknown,
): Record<string, unknown> {
  const content = asObject(input);
  if (!content) {
    throw new ApiError(400, "invalid_content", "content must be a JSON object");
  }

  if (itemType === "link") {
    const url = asString(content.url);
    const title = asString(content.title);
    if (!url || !isHttpUrl(url)) {
      throw new ApiError(400, "invalid_content", "link content.url must be a valid http(s) URL");
    }
    if (title.length > 100) {
      throw new ApiError(400, "invalid_content", "link content.title must be 100 characters or fewer");
    }
    return { url, title };
  }

  if (itemType === "frame") {
    const text = asString(content.text).slice(0, 280);
    if (!text) {
      throw new ApiError(400, "invalid_content", "frame content.text is required");
    }
    return { text };
  }

  if (itemType === "image") {
    const imageUrl = asString(content.image_url);
    const caption = asString(content.caption);
    if (!imageUrl || !isHttpUrl(imageUrl)) {
      throw new ApiError(400, "invalid_content", "image content.image_url must be a valid http(s) URL");
    }
    return { image_url: imageUrl, caption };
  }

  const targetChain = asString(content.target_chain);
  const targetCa = asString(content.target_ca);
  const targetName = asString(content.target_name);
  if (!targetChain || !targetCa) {
    throw new ApiError(400, "invalid_content", "portal content.target_chain and content.target_ca are required");
  }
  return {
    target_chain: targetChain,
    target_ca: targetCa,
    target_name: targetName,
  };
}

itemsRoute.get("/address/:wallet/items", async (c) => {
  await ensureBungalowItemsTable();

  const walletRaw = c.req.param("wallet");
  const wallet =
    normalizeAddress(walletRaw) ?? normalizeAddress(walletRaw, "solana");
  if (!wallet) {
    throw new ApiError(400, "invalid_wallet", "Invalid wallet address");
  }

  const limitRaw = Number.parseInt(c.req.query("limit") ?? "100", 10);
  const offsetRaw = Number.parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 200)
    : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const rows = await db<AddressContributionRow[]>`
    SELECT
      bi.id,
      bi.token_address,
      bi.chain,
      bi.item_type,
      bi.content,
      bi.placed_by,
      thh.heat_degrees::text AS placed_by_heat_degrees,
      bi.tx_hash,
      bi.jbm_amount::text AS jbm_amount,
      bi.created_at::text AS created_at,
      COALESCE(b.name, tr.name) AS bungalow_name,
      COALESCE(b.symbol, tr.symbol) AS bungalow_symbol,
      b.image_url AS bungalow_image_url
    FROM ${db(CONFIG.SCHEMA)}.bungalow_items bi
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_holder_heat thh
      ON thh.token_address = bi.token_address
      AND thh.wallet = bi.placed_by
    LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalows b
      ON b.token_address = bi.token_address
      AND b.chain = bi.chain
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = bi.token_address
      AND tr.chain = bi.chain
    WHERE bi.placed_by = ${wallet}
    ORDER BY bi.created_at DESC, bi.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const totalRows = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM ${db(CONFIG.SCHEMA)}.bungalow_items bi
    WHERE bi.placed_by = ${wallet}
  `;

  return c.json({
    wallet,
    items: rows,
    total: Number(totalRows[0]?.count ?? 0),
  });
});

itemsRoute.get("/bungalow/:chain/:ca/items", async (c) => {
  await ensureBungalowItemsTable();

  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  const filter = buildDeploymentWhereClause("bi", projectContext.deployments);

  const rows = await db.unsafe<BungalowItemRow[]>(
    `SELECT
      bi.id,
      bi.token_address,
      bi.chain,
      bi.item_type,
      bi.content,
      bi.placed_by,
      thh.heat_degrees::text AS placed_by_heat_degrees,
      bi.tx_hash,
      bi.jbm_amount::text AS jbm_amount,
      bi.created_at::text AS created_at
    FROM "${CONFIG.SCHEMA}".bungalow_items bi
    LEFT JOIN "${CONFIG.SCHEMA}".token_holder_heat thh
      ON thh.token_address = bi.token_address
      AND thh.wallet = bi.placed_by
    WHERE ${filter.clause}
    ORDER BY bi.created_at DESC, bi.id DESC`,
    filter.params,
  );

  return c.json({ items: rows });
});

itemsRoute.post("/bungalow/:chain/:ca/items", requirePrivyAuth, async (c) => {
  await ensureBungalowItemsTable();

  const claims = c.get("privyClaims") as Record<string, unknown> | undefined;
  const privyUserId = getPrivyUserIdFromClaims(claims);

  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    throw new ApiError(400, "invalid_chain", "Invalid chain");
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    throw new ApiError(400, "invalid_token", "Invalid token address");
  }

  const projectContext = await getCanonicalProjectContext(chain, tokenAddress);
  const storageDeployment = projectContext.primaryDeployment;

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

  const normalizedContent = normalizeItemContent(
    itemType as keyof typeof ITEM_PRICES,
    body.content,
  );

  const placedByRaw = typeof body.placed_by === "string" ? body.placed_by.trim() : "";
  if (!placedByRaw) {
    throw new ApiError(400, "invalid_placed_by", "placed_by is required");
  }

  const placedBy = normalizeAddress(placedByRaw, chain) ?? normalizeAddress(placedByRaw);
  if (!placedBy) {
    throw new ApiError(400, "invalid_placed_by", "placed_by must be a valid wallet address");
  }

  const ownsWallet = await userOwnsWallet(privyUserId, placedBy);
  if (!ownsWallet) {
    throw new ApiError(401, "wallet_not_owned", "wallet_not_owned");
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

  const existing = await db<BungalowItemRow[]>`
    SELECT
      bi.id,
      bi.token_address,
      bi.chain,
      bi.item_type,
      bi.content,
      bi.placed_by,
      thh.heat_degrees::text AS placed_by_heat_degrees,
      bi.tx_hash,
      bi.jbm_amount::text AS jbm_amount,
      bi.created_at::text AS created_at
    FROM ${db(CONFIG.SCHEMA)}.bungalow_items bi
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_holder_heat thh
      ON thh.token_address = bi.token_address
      AND thh.wallet = bi.placed_by
    WHERE bi.tx_hash = ${txHash}
    LIMIT 1
  `;
  if (existing.length > 0) {
    const existingItem = existing[0];
    const matchesCanonicalDeployment = projectContext.deployments.some(
      (deployment) =>
        deployment.token_address === existingItem.token_address &&
        deployment.chain === existingItem.chain,
    );

    if (!matchesCanonicalDeployment) {
      throw new ApiError(409, "duplicate_tx_hash", "tx_hash has already been used");
    }
    return c.json({ item: existingItem, idempotent: true }, 200);
  }

  const rows = await db<BungalowItemRow[]>`
    WITH inserted AS (
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
        ${storageDeployment.token_address},
        ${storageDeployment.chain},
        ${itemType},
        ${JSON.stringify(normalizedContent)}::jsonb,
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
    )
    SELECT
      inserted.id,
      inserted.token_address,
      inserted.chain,
      inserted.item_type,
      inserted.content,
      inserted.placed_by,
      thh.heat_degrees::text AS placed_by_heat_degrees,
      inserted.tx_hash,
      inserted.jbm_amount,
      inserted.created_at
    FROM inserted
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_holder_heat thh
      ON thh.token_address = inserted.token_address
      AND thh.wallet = inserted.placed_by
  `;

  return c.json({ item: rows[0] }, 201);
});

export default itemsRoute;
