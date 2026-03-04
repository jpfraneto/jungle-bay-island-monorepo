import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CONFIG, db, publicClients } from "./config";
import { requestLogMiddleware } from "./middleware/requestLog";
import { requestIdMiddleware } from "./middleware/requestId";
import { createRateLimit } from "./middleware/rateLimit";
import bungalowRoute from "./routes/bungalow";
import bungalowAdminRoute from "./routes/bungalow-admin";
import healthRoute from "./routes/health";
import tokenRoute from "./routes/token";
import bungalowsRoute from "./routes/bungalows";
import userRoute from "./routes/user";
import claimRoute from "./routes/claim";
import claimPriceRoute from "./routes/claim-price";
import scanRoute from "./routes/scan";
import leaderboardRoute from "./routes/leaderboard";
import personaRoute from "./routes/persona";
import ogRoute from "./routes/og";
import agentRoute from "./routes/agent";
import widgetRoute from "./routes/widget";
import v1BungalowRoute from "./routes/v1-bungalow";
import { homeTeamRoute } from "./routes/home-team";
import itemsRoute from "./routes/items";
import claimsRoute from "./routes/claims";
import bodegaRoute from "./routes/bodega";
import walletLinkRoute from "./routes/wallet-link";
import { startDailyHeatRefreshScheduler } from "./services/dailyHeatRefresh";
import { isApiError } from "./services/errors";
import { logError, logWarn } from "./services/logger";
import type { AppEnv } from "./types";

const STATIC_DIR = path.resolve(import.meta.dir, "../public");
const MANIFEST_PATH = path.join(STATIC_DIR, "island", ".vite", "manifest.json");

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveIslandAssetTags(): string {
  if (!fs.existsSync(MANIFEST_PATH)) {
    logWarn("ISLAND", `Missing Vite manifest at ${MANIFEST_PATH}. Serving shell without assets.`);
    return "";
  }

  try {
    const manifest = JSON.parse(
      fs.readFileSync(MANIFEST_PATH, "utf-8"),
    ) as Record<string, { file?: string; css?: string[]; isEntry?: boolean }>;

    const entries = Object.values(manifest);
    const entry =
      manifest["index.html"] ??
      manifest["src/main.tsx"] ??
      entries.find((item) => item.isEntry) ??
      entries.find((item) => item.file?.endsWith(".js") || item.file?.endsWith(".mjs"));

    const jsFile = entry?.file;
    if (!jsFile) {
      logWarn("ISLAND", "No JS entry found in Vite manifest. Serving shell without assets.");
      return "";
    }

    const cssFiles = [...new Set(entry?.css ?? [])];

    const cssTags = cssFiles
      .map((cssFile) => `  <link rel="stylesheet" href="${escapeHtml(`/island/${cssFile}`)}" />`)
      .join("\n");
    const scriptTag = `  <script type="module" src="${escapeHtml(`/island/${jsFile}`)}"></script>`;

    return [cssTags, scriptTag].filter(Boolean).join("\n");
  } catch (error) {
    logWarn(
      "ISLAND",
      `Failed to parse island manifest: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "";
  }
}

let cachedIslandAssetTags = "";
let cachedIslandManifestMtimeMs: number | null = null;
let hasWarnedMissingManifest = false;

function getIslandAssetTags(): string {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(MANIFEST_PATH);
  } catch {
    if (!hasWarnedMissingManifest) {
      logWarn("ISLAND", `Missing Vite manifest at ${MANIFEST_PATH}. Serving shell without assets.`);
      hasWarnedMissingManifest = true;
    }
    cachedIslandManifestMtimeMs = null;
    cachedIslandAssetTags = "";
    return "";
  }

  hasWarnedMissingManifest = false;

  if (cachedIslandManifestMtimeMs === stats.mtimeMs && cachedIslandAssetTags) {
    return cachedIslandAssetTags;
  }

  cachedIslandManifestMtimeMs = stats.mtimeMs;
  cachedIslandAssetTags = resolveIslandAssetTags();
  return cachedIslandAssetTags;
}

function renderSpaShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jungle Bay Island</title>
  <meta property="og:title" content="Jungle Bay Island" />
  <meta property="og:description" content="Where meme culture finds a home" />
  <meta property="og:image" content="/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>body{margin:0;background:#070f0a;}</style>
  ${getIslandAssetTags()}
</head>
<body>
  <div id="island-root"></div>
</body>
</html>`;
}

const app = new Hono<AppEnv>();
const allowedOrigins = CONFIG.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAnyOrigin = allowedOrigins.includes("*");

app.use("*", requestIdMiddleware);
app.use("*", requestLogMiddleware);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowAnyOrigin) return origin || "*";
      if (!origin) return allowedOrigins[0] ?? "";
      return allowedOrigins.includes(origin) ? origin : "";
    },
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Wallet-Address",
      "X-Payment-Proof",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Prevent stale caching on all responses.
app.use("*", async (c, next) => {
  await next();

  const ct = c.res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    // Tell Cloudflare's edge cache not to store HTML (separate from browser Cache-Control)
    c.res.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    c.res.headers.set("CDN-Cache-Control", "no-store");
  }

  if (c.req.path.startsWith("/api/") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

app.use(
  "/api/*",
  createRateLimit({
    limit: CONFIG.GENERAL_RATE_LIMIT_PER_MIN,
    windowMs: 60 * 1000,
  }),
);

// --- API routes ---
app.route("/api", healthRoute);
app.route("/api", bungalowRoute);
app.route("/api", bungalowAdminRoute);
app.route("/api", tokenRoute);
app.route("/api", bungalowsRoute);
app.route("/api", userRoute);
app.route("/api", claimRoute);
app.route("/api", claimPriceRoute);
app.route("/api", scanRoute);
app.route("/api", leaderboardRoute);
app.route("/api", personaRoute);
app.route("/api", ogRoute);
app.route("/api", agentRoute);
app.route("/api", widgetRoute);
app.route("/api", v1BungalowRoute);
app.route("/api", homeTeamRoute);
app.route("/api", itemsRoute);
app.route("/api", claimsRoute);
app.route("/api/bodega", bodegaRoute);
app.route("/api/wallet", walletLinkRoute);

// Solana RPC proxy (browser can't hit public RPC directly due to CORS/403)
app.post("/api/solana-rpc", async (c) => {
  try {
    const body = await c.req.json();
    const allowedMethods = new Set([
      "getLatestBlockhash",
      "getTokenAccountBalance",
      "getAccountInfo",
    ]);

    if (!allowedMethods.has(body.method)) {
      return c.json({ error: "Method not allowed" }, 403 as any);
    }

    const rpcUrl = CONFIG.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com";

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ error: "RPC proxy failed" }, 502 as any);
  }
});

// --- Static files from backend/public/ ---
const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

app.use("*", async (c, next) => {
  const reqPath = new URL(c.req.url).pathname;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(reqPath);
  } catch {
    return next();
  }

  const ext = path.extname(decodedPath).toLowerCase();
  if (!MIME_TYPES[ext]) {
    return next();
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.includes("..")
  ) {
    return next();
  }

  const filePath = path.resolve(STATIC_DIR, relativePath);
  if (!filePath.startsWith(`${STATIC_DIR}${path.sep}`)) {
    return next();
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    if (c.req.path.startsWith("/api/")) {
      return next();
    }
    return c.text("Not Found", 404);
  }

  c.header("Content-Type", MIME_TYPES[ext]);
  // Hashed assets are content-addressed — safe to cache for 1 year
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(await file.arrayBuffer());
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        error: "Route not found",
        code: "not_found",
        request_id: c.get("requestId") ?? null,
      },
      404 as any,
    );
  }

  return c.html(renderSpaShell());
});

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  logError(
    "ERR",
    `request_id=${requestId} method=${c.req.method} path=${c.req.path} message=${error instanceof Error ? error.message : "unknown"}`,
  );

  if (isApiError(error)) {
    return c.json(
      {
        error: error.message,
        code: error.code,
        status: error.status,
        request_id: requestId,
        details: error.details ?? null,
      },
      error.status as any,
    );
  }

  logError(
    "ERR",
    `request_id=${requestId} ${error instanceof Error ? (error.stack ?? error.message) : "unknown error object"}`,
  );

  return c.json(
    {
      error: "Internal server error",
      code: "internal_error",
      status: 500,
      request_id: requestId,
    },
    500 as any,
  );
});

const G = "\x1b[32m";
const D = "\x1b[2m";
const B = "\x1b[1m";
const R = "\x1b[0m";
const Y = "\x1b[33m";
const RE = "\x1b[31m";

function statusDot(ok: boolean): string {
  return ok ? `${G}●${R}` : `${RE}●${R}`;
}

async function logStartupStatus(): Promise<void> {
  const startedAt = Date.now();

  const [dbResult, baseHeadResult, ethHeadResult] = await Promise.allSettled([
    db`SELECT NOW()::text AS now`,
    publicClients.base.getBlockNumber(),
    publicClients.ethereum.getBlockNumber(),
  ]);

  const dbOk = dbResult.status === "fulfilled";
  const baseOk = baseHeadResult.status === "fulfilled";
  const ethOk = ethHeadResult.status === "fulfilled";
  const baseHead = baseOk
    ? (baseHeadResult as PromiseFulfilledResult<bigint>).value
    : null;
  const ethHead = ethOk
    ? (ethHeadResult as PromiseFulfilledResult<bigint>).value
    : null;
  const ms = Date.now() - startedAt;

  const corsDisplay =
    CONFIG.CORS_ORIGIN.length > 50
      ? CONFIG.CORS_ORIGIN.slice(0, 47) + "..."
      : CONFIG.CORS_ORIGIN;

  console.log("");
  console.log(`  ${G}${B}Jungle Bay Island${R}  ${D}v1.0${R}`);
  console.log(`  ${D}${"─".repeat(40)}${R}`);
  console.log("");
  console.log(`  ${D}Server${R}     http://localhost:${B}${CONFIG.PORT}${R}`);
  console.log(`  ${D}Schema${R}     ${CONFIG.SCHEMA}`);
  console.log(`  ${D}CORS${R}       ${corsDisplay}`);
  console.log("");
  console.log(`  ${D}Connections${R}`);
  console.log(
    `  ${statusDot(dbOk)}  PostgreSQL   ${dbOk ? `${G}connected${R}` : `${RE}failed${R}`}`,
  );
  console.log(
    `  ${statusDot(baseOk)}  Base RPC     ${baseOk ? `${G}block ${baseHead}${R}` : `${RE}failed${R}`}`,
  );
  console.log(
    `  ${statusDot(ethOk)}  Ethereum RPC ${ethOk ? `${G}block ${ethHead}${R}` : `${RE}failed${R}`}`,
  );
  console.log(
    `  ${statusDot(!!CONFIG.NEYNAR_API_KEY)}  Neynar       ${CONFIG.NEYNAR_API_KEY ? `${G}configured${R}` : `${Y}not set${R}`}`,
  );
  console.log("");
  console.log(`  ${D}Routes${R}     /api/*  /island/*  /* (SPA)`);
  console.log(`  ${D}Health${R}     GET  /api/health`);
  console.log("");
  console.log(`  ${D}Ready in ${ms}ms${R}`);
  console.log("");

  if (!dbOk) {
    logWarn(
      "BOOT",
      "Database connection failed. API is up but data routes may error.",
    );
  }
}

if (import.meta.main) {
  await logStartupStatus();
  startDailyHeatRefreshScheduler();
}

export default {
  port: CONFIG.PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};
