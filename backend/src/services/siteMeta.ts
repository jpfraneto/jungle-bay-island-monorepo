import { CONFIG } from "../config";

export const SITE_NAME = "Jungle Bay Island";
export const SITE_TITLE = "Jungle Bay Island | The Home Of Memes";
export const SITE_DESCRIPTION =
  "Welcome to the persistent cultural layer that gives tokens a bungalow, where to live over time.";
export const SITE_OG_IMAGE_PATH = "/og-image.png";
export const SITE_OG_IMAGE_ALT =
  "Jungle Bay Island Open Graph artwork";
export const SITE_OG_IMAGE_TYPE = "image/png";
export const SITE_OG_IMAGE_WIDTH = "1200";
export const SITE_OG_IMAGE_HEIGHT = "634";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readForwardedValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function getSiteUrl(): string {
  const serverUrl = process.env.SERVER_URL?.trim();
  if (serverUrl && /^https?:\/\//i.test(serverUrl)) {
    return trimTrailingSlash(serverUrl);
  }

  const publicOrigin = CONFIG.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .find((origin) => origin && origin !== "*" && /^https?:\/\//i.test(origin));
  if (publicOrigin) {
    return trimTrailingSlash(publicOrigin);
  }

  return "https://memetics.lat";
}

export function getRequestSiteUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedHost =
    readForwardedValue(request.headers.get("x-forwarded-host")) ??
    readForwardedValue(request.headers.get("host"));
  let forwardedProto = readForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );

  if (!forwardedProto) {
    const cfVisitor = request.headers.get("cf-visitor");
    if (cfVisitor) {
      try {
        const parsed = JSON.parse(cfVisitor) as { scheme?: string };
        if (parsed.scheme === "http" || parsed.scheme === "https") {
          forwardedProto = parsed.scheme;
        }
      } catch {
        // Ignore malformed Cloudflare visitor header.
      }
    }
  }

  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/, "");
  const host = forwardedHost ?? requestUrl.host;
  return `${protocol}://${host}`;
}

export function getAbsoluteUrl(pathOrUrl: string, siteUrl?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  const baseUrl = siteUrl ? trimTrailingSlash(siteUrl) : getSiteUrl();
  return `${baseUrl}${normalizedPath}`;
}

export function getSiteOgImageUrl(siteUrl?: string): string {
  return getAbsoluteUrl(SITE_OG_IMAGE_PATH, siteUrl);
}

export function buildBungalowDescription(
  tokenName: string,
  tokenSymbol?: string | null,
): string {
  const cleanName = tokenName.trim() || "This token";
  const cleanSymbol = tokenSymbol?.trim();
  const label = cleanSymbol ? `${cleanName} ($${cleanSymbol})` : cleanName;
  return `${label} on Jungle Bay Island, where token holders claim bungalows, post on the bulletin board, and build Heat.`;
}

export function renderSocialMeta(input?: {
  title?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  imageAlt?: string;
  type?: "website" | "article";
  siteName?: string;
  siteUrl?: string;
}): string {
  const title = input?.title ?? SITE_TITLE;
  const description = input?.description ?? SITE_DESCRIPTION;
  const url = getAbsoluteUrl(input?.url ?? "/", input?.siteUrl);
  const imageUrl = getAbsoluteUrl(
    input?.imageUrl ?? SITE_OG_IMAGE_PATH,
    input?.siteUrl,
  );
  const imageAlt = input?.imageAlt ?? SITE_OG_IMAGE_ALT;
  const type = input?.type ?? "website";
  const siteName = input?.siteName ?? SITE_NAME;

  return [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
    `<meta property="og:image:type" content="${SITE_OG_IMAGE_TYPE}" />`,
    `<meta property="og:image:width" content="${SITE_OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${SITE_OG_IMAGE_HEIGHT}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`,
  ].join("\n  ");
}
