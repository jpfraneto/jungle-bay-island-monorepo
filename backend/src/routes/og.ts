import { Hono } from 'hono'
import { getBungalow } from '../db/queries'
import { normalizeAddress, toSupportedChain } from '../config'
import { getCached, setCached } from '../services/cache'
import { ApiError } from '../services/errors'
import { logError, logInfo } from '../services/logger'
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

  const bungalow = await getBungalow(tokenAddress, chain)

  const title = bungalow?.name
    ? `${bungalow.name} (${bungalow.symbol ?? ''}) — Jungle Bay Island`
    : 'Jungle Bay Island'
  const description = bungalow?.description
    ?? `View the bungalow for ${bungalow?.name ?? tokenAddress} on Jungle Bay Island.`
  const image = bungalow?.image_url ?? ''
  // SPA URL — derive from CORS_ORIGIN or fallback
  const spaOrigin = (process.env.CORS_ORIGIN ?? 'https://junglebay.island').split(',')[0].trim()
  const canonicalUrl = `${spaOrigin}/${chain}/${tokenAddress}`

  logInfo('OG PAGE', `chain=${chain} token=${tokenAddress} name=${bungalow?.name ?? 'unknown'}`)

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default ogRoute
