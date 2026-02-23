import { Hono } from 'hono'
import { CONFIG, normalizeAddress, toSupportedChain } from '../config'
import { getBungalow, getLatestScanByToken } from '../db/queries'
import { getCached, setCached } from '../services/cache'
import { ApiError } from '../services/errors'
import { logError, logInfo } from '../services/logger'
import { resolveTokenMetadata } from '../services/tokenMetadata'
import type { AppEnv } from '../types'

const ogRoute = new Hono<AppEnv>()

const OG_CACHE_MS = 60 * 60 * 1000 // 1 hour

// --- OG metadata proxy: fetch OG tags from any URL ---
ogRoute.get('/og', async (c) => {
  const rawUrl = c.req.query('url')
  if (!rawUrl) {
    throw new ApiError(400, 'missing_url', 'url query parameter is required')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ApiError(400, 'invalid_url', 'Invalid URL provided')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'invalid_protocol', 'Only http and https URLs are supported')
  }

  // Block internal/private IPs
  const hostname = parsed.hostname
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.') ||
    hostname === '::1'
  ) {
    throw new ApiError(400, 'blocked_url', 'Internal URLs are not allowed')
  }

  const cacheKey = `og:${rawUrl}`
  const cached = getCached<Record<string, string | null>>(cacheKey)
  if (cached) {
    return c.json(cached)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'JungleBayBot/1.0' },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!resp.ok) {
      return c.json({ title: null, description: null, image: null, url: rawUrl, site_name: null })
    }

    const html = await resp.text()

    const getMetaContent = (property: string): string | null => {
      // Match both property="og:X" and name="og:X"
      const regex = new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']|` +
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
        'i',
      )
      const match = html.match(regex)
      return match?.[1] ?? match?.[2] ?? null
    }

    const result = {
      title: getMetaContent('og:title') ?? getMetaContent('twitter:title') ?? null,
      description: getMetaContent('og:description') ?? getMetaContent('twitter:description') ?? null,
      image: getMetaContent('og:image') ?? getMetaContent('twitter:image') ?? null,
      url: getMetaContent('og:url') ?? rawUrl,
      site_name: getMetaContent('og:site_name') ?? null,
    }

    setCached(cacheKey, result, OG_CACHE_MS)
    return c.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    logError('OG PROXY', `url=${rawUrl} error="${msg}"`)
    return c.json({ title: null, description: null, image: null, url: rawUrl, site_name: null })
  }
})

// --- OG page for social sharing: returns HTML with OG meta tags ---
ogRoute.get('/og-page/:chain/:ca', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    return c.text('Invalid chain', 400)
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    return c.text('Invalid address', 400)
  }

  const tokenMeta = await resolveTokenMetadata(tokenAddress, chain)

  const title = tokenMeta.name
    ? `${tokenMeta.name}${tokenMeta.symbol ? ` (${tokenMeta.symbol})` : ''} — Jungle Bay Island`
    : `Token ${tokenAddress.slice(0, 8)}... — Jungle Bay Island`
  const description = tokenMeta.description
    ?? `View the bungalow for ${tokenMeta.name ?? tokenAddress} on Jungle Bay Island.`
  const image = tokenMeta.image_url ?? ''
  // SPA URL — derive from CORS_ORIGIN or fallback
  const spaOrigin = (process.env.CORS_ORIGIN ?? 'https://junglebay.island').split(',')[0].trim()
  const canonicalUrl = `${spaOrigin}/${chain}/${tokenAddress}`

  logInfo('OG PAGE', `chain=${chain} token=${tokenAddress} name=${tokenMeta.name ?? 'unknown'}`)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ''}
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="Jungle Bay Island" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonicalUrl)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`

  return c.html(html)
})

// --- Dynamic OG image for bungalow embeds (SVG) ---
const OG_IMAGE_CACHE_MS = 10 * 60 * 1000 // 10 minutes

function fmtNum(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function svgEsc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

ogRoute.get('/og-image/:chain/:ca', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) return c.text('Invalid chain', 400)

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) return c.text('Invalid address', 400)

  const cacheKey = `og-img:${chain}:${tokenAddress}`
  const cachedSvg = getCached<string>(cacheKey)
  if (cachedSvg) {
    c.header('Content-Type', 'image/svg+xml')
    c.header('Cache-Control', 'public, max-age=600')
    return c.body(cachedSvg)
  }

  const [bungalow, tokenMeta, scanLog] = await Promise.all([
    getBungalow(tokenAddress, chain),
    resolveTokenMetadata(tokenAddress, chain),
    getLatestScanByToken(tokenAddress),
  ])

  const name = bungalow?.name ?? tokenMeta.name ?? 'Unknown Token'
  const symbol = bungalow?.symbol ?? tokenMeta.symbol ?? ''
  const imageUrl = bungalow?.image_url ?? tokenMeta.image_url ?? null
  const holders = bungalow?.holder_count ?? scanLog?.holders_found ?? 0
  const transfers = scanLog?.events_fetched ?? 0
  const chainLabel = chain === 'base' ? 'Base' : chain === 'solana' ? 'Solana' : 'Ethereum'

  const displayName = symbol ? `$${svgEsc(symbol)}` : svgEsc(name.slice(0, 20))
  const subtitle = symbol && name !== symbol ? svgEsc(name.slice(0, 30)) : ''

  // Generate SVG — 1200x630 (standard OG size)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#13131a"/>
    </linearGradient>
    <clipPath id="circle"><circle cx="160" cy="240" r="70"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Border accent line -->
  <rect x="0" y="0" width="1200" height="4" fill="#22d3ee"/>

  <!-- Token image (circle) -->
  ${imageUrl
    ? `<image href="${svgEsc(imageUrl)}" x="90" y="170" width="140" height="140" clip-path="url(#circle)" preserveAspectRatio="xMidYMid slice"/>
       <circle cx="160" cy="240" r="70" fill="none" stroke="#2a2a3a" stroke-width="3"/>`
    : `<circle cx="160" cy="240" r="70" fill="#1a1a24" stroke="#2a2a3a" stroke-width="3"/>
       <text x="160" y="248" text-anchor="middle" font-family="monospace" font-size="40" fill="#71717a">?</text>`
  }

  <!-- Token name -->
  <text x="270" y="210" font-family="monospace" font-size="52" font-weight="bold" fill="#e4e4e7">${displayName}</text>
  ${subtitle ? `<text x="270" y="260" font-family="monospace" font-size="24" fill="#71717a">${subtitle}</text>` : ''}

  <!-- Chain badge -->
  <rect x="270" y="${subtitle ? '280' : '240'}" width="${chainLabel.length * 12 + 24}" height="30" rx="4" fill="#1a1a24" stroke="#2a2a3a" stroke-width="1"/>
  <text x="282" y="${subtitle ? '300' : '260'}" font-family="monospace" font-size="14" fill="#71717a">${chainLabel}</text>

  <!-- Stats row -->
  <g transform="translate(90, 400)">
    <!-- Holders -->
    <rect width="320" height="120" rx="8" fill="#13131a" stroke="#2a2a3a" stroke-width="1"/>
    <text x="160" y="45" text-anchor="middle" font-family="monospace" font-size="14" fill="#71717a" letter-spacing="2">HOLDERS</text>
    <text x="160" y="90" text-anchor="middle" font-family="monospace" font-size="44" font-weight="bold" fill="#22d3ee">${fmtNum(holders)}</text>

    <!-- Transfers -->
    <g transform="translate(350, 0)">
      <rect width="320" height="120" rx="8" fill="#13131a" stroke="#2a2a3a" stroke-width="1"/>
      <text x="160" y="45" text-anchor="middle" font-family="monospace" font-size="14" fill="#71717a" letter-spacing="2">TRANSFERS</text>
      <text x="160" y="90" text-anchor="middle" font-family="monospace" font-size="44" font-weight="bold" fill="#fb923c">${fmtNum(transfers)}</text>
    </g>
  </g>

  <!-- Branding -->
  <text x="1140" y="590" text-anchor="end" font-family="monospace" font-size="18" font-weight="bold" fill="#22d3ee" letter-spacing="3">MEMETICS</text>
  <text x="1140" y="612" text-anchor="end" font-family="monospace" font-size="12" fill="#71717a">memetics.lat</text>
</svg>`

  setCached(cacheKey, svg, OG_IMAGE_CACHE_MS)
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=600')
  return c.body(svg)
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default ogRoute
