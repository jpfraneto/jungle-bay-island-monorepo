import { Hono } from "hono";
import { normalizeAddress, toSupportedChain } from "../config";
import { getCached, setCached } from "../services/cache";
import { ApiError } from "../services/errors";
import { logError, logInfo } from "../services/logger";
import {
  buildBungalowDescription,
  getAbsoluteUrl,
  getSiteOgImageUrl,
  renderSocialMeta,
} from "../services/siteMeta";
import { resolveTokenMetadata } from "../services/tokenMetadata";
import type { AppEnv } from "../types";

const ogRoute = new Hono<AppEnv>();

const OG_CACHE_MS = 60 * 60 * 1000; // 1 hour

// --- Image proxy: fetches any public image and re-serves it with CORS headers ---
// This lets the WebGL TextureLoader load images that don't send their own CORS headers.
const IMAGE_PROXY_CACHE_MS = 30 * 60 * 1000; // 30 minutes
const IMAGE_PROXY_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
]);

ogRoute.get("/proxy-image", async (c) => {
  const rawUrl = c.req.query("url");
  if (!rawUrl) {
    return c.text("missing url", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return c.text("invalid url", 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return c.text("only http/https allowed", 400);
  }

  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.") ||
    hostname === "::1"
  ) {
    return c.text("internal urls not allowed", 400);
  }

  const cacheKey = `proxy-img:${rawUrl}`;
  const cached = getCached<{ contentType: string; data: number[] }>(cacheKey);
  if (cached) {
    c.header("Content-Type", cached.contentType);
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=1800");
    return c.body(new Uint8Array(cached.data));
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "JungleBayBot/1.0" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return c.text(`upstream ${resp.status}`, 502);
    }

    const contentType = resp.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      // Allow unknown types through — might be a valid image without a standard content-type
    }

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > IMAGE_PROXY_MAX_BYTES) {
      return c.text("image too large", 413);
    }

    const bytes = new Uint8Array(buffer);
    const finalContentType = contentType || "image/jpeg";

    setCached(cacheKey, { contentType: finalContentType, data: Array.from(bytes) }, IMAGE_PROXY_CACHE_MS);

    c.header("Content-Type", finalContentType);
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=1800");
    return c.body(bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    logError("IMAGE PROXY", `url=${rawUrl} error="${msg}"`);
    return c.text("failed to fetch image", 502);
  }
});

// --- OG metadata proxy: fetch OG tags from any URL ---
ogRoute.get("/og", async (c) => {
  const rawUrl = c.req.query("url");
  if (!rawUrl) {
    throw new ApiError(400, "missing_url", "url query parameter is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, "invalid_url", "Invalid URL provided");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(
      400,
      "invalid_protocol",
      "Only http and https URLs are supported",
    );
  }

  // Block internal/private IPs
  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.") ||
    hostname === "::1"
  ) {
    throw new ApiError(400, "blocked_url", "Internal URLs are not allowed");
  }

  const cacheKey = `og:${rawUrl}`;
  const cached = getCached<Record<string, string | null>>(cacheKey);
  if (cached) {
    return c.json(cached);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "JungleBayBot/1.0" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return c.json({
        title: null,
        description: null,
        image: null,
        url: rawUrl,
        site_name: null,
      });
    }

    const html = await resp.text();

    const getMetaContent = (property: string): string | null => {
      // Match both property="og:X" and name="og:X"
      const regex = new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']|` +
          `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
        "i",
      );
      const match = html.match(regex);
      return match?.[1] ?? match?.[2] ?? null;
    };

    const result = {
      title:
        getMetaContent("og:title") ?? getMetaContent("twitter:title") ?? null,
      description:
        getMetaContent("og:description") ??
        getMetaContent("twitter:description") ??
        null,
      image:
        getMetaContent("og:image") ?? getMetaContent("twitter:image") ?? null,
      url: getMetaContent("og:url") ?? rawUrl,
      site_name: getMetaContent("og:site_name") ?? null,
    };

    setCached(cacheKey, result, OG_CACHE_MS);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    logError("OG PROXY", `url=${rawUrl} error="${msg}"`);
    return c.json({
      title: null,
      description: null,
      image: null,
      url: rawUrl,
      site_name: null,
    });
  }
});

// --- OG page for social sharing: returns HTML with OG meta tags ---
ogRoute.get("/og-page/:chain/:ca", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) {
    return c.text("Invalid chain", 400);
  }

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) {
    return c.text("Invalid address", 400);
  }

  const tokenMeta = await resolveTokenMetadata(tokenAddress, chain);

  const title = tokenMeta.name
    ? `${tokenMeta.name}${tokenMeta.symbol ? ` (${tokenMeta.symbol})` : ""} | Jungle Bay Island`
    : `Token ${tokenAddress.slice(0, 8)}... | Jungle Bay Island`;
  const description = buildBungalowDescription(
    tokenMeta.name ?? tokenAddress,
    tokenMeta.symbol ?? null,
  );
  const canonicalUrl = getAbsoluteUrl(`/${chain}/${tokenAddress}`);

  logInfo(
    "OG PAGE",
    `chain=${chain} token=${tokenAddress} name=${tokenMeta.name ?? "unknown"}`,
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  ${renderSocialMeta({
    title,
    description,
    url: canonicalUrl,
    imageAlt: `${tokenMeta.name ?? tokenAddress} on Jungle Bay Island`,
  })}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonicalUrl)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`;

  return c.html(html);
});

ogRoute.get("/og-image/:chain/:ca", async (c) => {
  const chain = toSupportedChain(c.req.param("chain"));
  if (!chain) return c.text("Invalid chain", 400);

  const tokenAddress = normalizeAddress(c.req.param("ca"), chain);
  if (!tokenAddress) return c.text("Invalid address", 400);
  c.header("Cache-Control", "public, max-age=3600");
  return c.redirect(getSiteOgImageUrl(), 302);
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default ogRoute;
