import { Hono } from "hono";
import { decodeProtectedHeader, importJWK, importSPKI } from "jose";
import type { JWK } from "jose";
import { CONFIG, db } from "../config";
import {
  adminDeactivateBungalowItem,
  adminDeactivateCatalogItem,
} from "../db/queries";
import { requireAgentAuth, verifyPrivyToken } from "../middleware/auth";
import type { AppEnv } from "../types";

const opsRoute = new Hono<AppEnv>();
opsRoute.use("*", requireAgentAuth);

let moderationColumnsPromise: Promise<void> | null = null;

interface KeyHealth {
  format: "spki" | "jwk" | "unknown";
  parse_ok: boolean;
  error?: string;
}

interface JwksHealth {
  reachable: boolean;
  url: string;
  fetch_ms: number;
  key_count?: number;
  kids?: string[];
  error?: string;
}

interface TokenHealth {
  provided: boolean;
  header?: {
    alg: string;
    kid: string;
    typ: string;
    length: number;
  };
  verified: boolean;
  wallet?: string;
  issuer?: string;
  error?: string;
}

function parseBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
}

function detectVerificationKeyFormat(rawKey: string): "spki" | "jwk" | "unknown" {
  const normalized = rawKey.trim().replace(/\\n/g, "\n");
  if (normalized.startsWith("-----BEGIN PUBLIC KEY-----")) return "spki";
  if (normalized.startsWith("{")) return "jwk";
  return "unknown";
}

async function checkLocalVerificationKey(rawKey: string): Promise<KeyHealth> {
  const normalized = rawKey.trim().replace(/\\n/g, "\n");
  const format = detectVerificationKeyFormat(rawKey);

  if (format === "unknown") {
    return {
      format,
      parse_ok: false,
      error: "Unsupported PRIVY_VERIFICATION_KEY format",
    };
  }

  try {
    if (format === "spki") {
      await importSPKI(normalized, "ES256");
      return { format, parse_ok: true };
    }

    const jwk = JSON.parse(normalized) as JWK;
    const alg = typeof jwk.alg === "string" ? jwk.alg : "ES256";
    await importJWK(jwk, alg);
    return { format, parse_ok: true };
  } catch (error) {
    return {
      format,
      parse_ok: false,
      error: normalizeError(error),
    };
  }
}

async function checkRemoteJwks(appId: string): Promise<JwksHealth> {
  const url = `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`;
  const started = Date.now();

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(payload.keys) ? payload.keys : [];
    const kids = keys
      .map((key) => {
        const candidate = key as Record<string, unknown>;
        return typeof candidate.kid === "string" ? candidate.kid : null;
      })
      .filter((kid): kid is string => Boolean(kid))
      .slice(0, 8);

    return {
      reachable: true,
      url,
      fetch_ms: Date.now() - started,
      key_count: keys.length,
      kids,
    };
  } catch (error) {
    return {
      reachable: false,
      url,
      fetch_ms: Date.now() - started,
      error: normalizeError(error),
    };
  }
}

function summarizeTokenHeader(token: string): TokenHealth["header"] {
  try {
    const header = decodeProtectedHeader(token);
    return {
      alg: typeof header.alg === "string" ? header.alg : "unknown",
      kid: typeof header.kid === "string" ? header.kid : "unknown",
      typ: typeof header.typ === "string" ? header.typ : "unknown",
      length: token.length,
    };
  } catch {
    return {
      alg: "unparseable",
      kid: "unknown",
      typ: "unknown",
      length: token.length,
    };
  }
}

async function ensureModerationColumns(): Promise<void> {
  if (!moderationColumnsPromise) {
    moderationColumnsPromise = (async () => {
      for (const statement of [
        `ALTER TABLE "${CONFIG.SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_reason TEXT`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_by TEXT`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bodega_catalog ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_reason TEXT`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_by TEXT`,
        `ALTER TABLE "${CONFIG.SCHEMA}".bungalow_items ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`,
      ]) {
        await db.unsafe(statement);
      }
    })();
  }

  await moderationColumnsPromise;
}

opsRoute.get("/health-auth", async (c) => {
  const [localKey, remoteJwks] = await Promise.all([
    checkLocalVerificationKey(CONFIG.PRIVY_VERIFICATION_KEY),
    checkRemoteJwks(CONFIG.PRIVY_APP_ID),
  ]);

  const bearerToken = parseBearerToken(c.req.header("Authorization"));
  const tokenCheck: TokenHealth = {
    provided: Boolean(bearerToken),
    verified: false,
  };

  if (bearerToken) {
    tokenCheck.header = summarizeTokenHeader(bearerToken);
    try {
      const verified = await verifyPrivyToken(bearerToken);
      tokenCheck.verified = true;
      tokenCheck.wallet = verified.walletAddress ?? undefined;
      tokenCheck.issuer =
        typeof verified.payload.iss === "string" ? verified.payload.iss : "unknown";
    } catch (error) {
      tokenCheck.error = normalizeError(error);
    }
  }

  const configOk = localKey.parse_ok || remoteJwks.reachable;
  const tokenOk = !tokenCheck.provided || tokenCheck.verified;
  const status = configOk && tokenOk ? "ok" : "degraded";

  return c.json(
    {
      status,
      ts: new Date().toISOString(),
      auth_guard: "agent_api_key_required",
      config: {
        privy_app_id_present: CONFIG.PRIVY_APP_ID.trim().length > 0,
        local_verification_key: localKey,
        remote_jwks: remoteJwks,
      },
      token_check: tokenCheck,
    },
    status === "ok" ? 200 : 503,
  );
});

opsRoute.post("/moderation/bodega/catalog/:id/deactivate", async (c) => {
  await ensureModerationColumns();

  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid catalog item id" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : "Emergency moderation";
  const agentName = c.get("agentName") ?? "ops";

  const ok = await adminDeactivateCatalogItem({
    id,
    reason,
    moderated_by: agentName,
  });
  if (!ok) {
    return c.json({ error: "Catalog item not found" }, 404);
  }

  return c.json({ ok: true, id, reason });
});

opsRoute.post("/moderation/bungalow-items/:id/deactivate", async (c) => {
  await ensureModerationColumns();

  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid bungalow item id" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : "Emergency moderation";
  const agentName = c.get("agentName") ?? "ops";

  const ok = await adminDeactivateBungalowItem({
    id,
    reason,
    moderated_by: agentName,
  });
  if (!ok) {
    return c.json({ error: "Bungalow item not found" }, 404);
  }

  return c.json({ ok: true, id, reason });
});

export default opsRoute;
