import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CONFIG, db, publicClients, normalizeAddress, toSupportedChain } from './config'
import { requestLogMiddleware } from './middleware/requestLog'
import { requestIdMiddleware } from './middleware/requestId'
import { createRateLimit } from './middleware/rateLimit'
import { getBungalow } from './db/queries'
import bungalowRoute from './routes/bungalow'
import healthRoute from './routes/health'
import tokenRoute from './routes/token'
import bungalowsRoute from './routes/bungalows'
import userRoute from './routes/user'
import claimRoute from './routes/claim'
import claimPriceRoute from './routes/claim-price'
import scanRoute from './routes/scan'
import leaderboardRoute from './routes/leaderboard'
import personaRoute from './routes/persona'
import ogRoute from './routes/og'
import agentRoute from './routes/agent'
import { isApiError } from './services/errors'
import { logError, logInfo, logSuccess, logWarn } from './services/logger'
import type { AppEnv } from './types'

// Bot user-agent patterns for social media crawlers
const BOT_UA_PATTERNS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Discordbot',
  'Slackbot',
  'TelegramBot',
  'WhatsApp',
  'Googlebot',
  'bingbot',
  'Pinterestbot',
]

function isBotRequest(userAgent: string | undefined): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_UA_PATTERNS.some((bot) => ua.includes(bot.toLowerCase()))
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const app = new Hono<AppEnv>()
const allowedOrigins = CONFIG.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowAnyOrigin = allowedOrigins.includes('*')

app.use('*', requestIdMiddleware)
app.use('*', requestLogMiddleware)

app.use('*', cors({
  origin: (origin) => {
    if (allowAnyOrigin) return origin || '*'
    if (!origin) return allowedOrigins[0] ?? ''
    return allowedOrigins.includes(origin) ? origin : ''
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Wallet-Address', 'X-Payment-Proof'],
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
}))

app.use(
  '/api/*',
  createRateLimit({
    limit: CONFIG.GENERAL_RATE_LIMIT_PER_MIN,
    windowMs: 60 * 1000,
  }),
)

app.route('/api', healthRoute)
app.route('/api', bungalowRoute)
app.route('/api', tokenRoute)
app.route('/api', bungalowsRoute)
app.route('/api', userRoute)
app.route('/api', claimRoute)
app.route('/api', claimPriceRoute)
app.route('/api', scanRoute)
app.route('/api', leaderboardRoute)
app.route('/api', personaRoute)
app.route('/api', ogRoute)
app.route('/api', agentRoute)

// --- skill.md for AI agents ---
app.get('/skill.md', async (c) => {
  const fs = await import('node:fs/promises')
  const filePath = path.resolve(import.meta.dir, '../skill.md')
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    c.header('Content-Type', 'text/markdown; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.body(content)
  } catch {
    return c.text('skill.md not found', 404)
  }
})

// --- Bot-detection middleware for OG meta tags ---
// Intercepts /:chain/:ca requests from social media crawlers
// and serves an HTML page with proper OG tags for link previews.
// Human visitors get the SPA as normal.
const VALID_CHAINS = new Set(['base', 'ethereum', 'solana'])

app.get('/:chain/:ca', async (c, next) => {
  const chain = c.req.param('chain')
  const ca = c.req.param('ca')

  // Only intercept if this looks like a bungalow route
  if (!VALID_CHAINS.has(chain)) return next()

  const userAgent = c.req.header('user-agent')
  if (!isBotRequest(userAgent)) return next()

  // Bot request — serve OG HTML
  const supported = toSupportedChain(chain)
  if (!supported) return next()

  const tokenAddress = normalizeAddress(ca, supported)
  if (!tokenAddress) return next()

  const bungalow = await getBungalow(tokenAddress, supported)

  const spaOrigin = (process.env.CORS_ORIGIN ?? 'https://memetics.lat').split(',')[0].trim()
  const canonicalUrl = `${spaOrigin}/${chain}/${tokenAddress}`
  const title = bungalow?.name
    ? `${bungalow.name} (${bungalow.symbol ?? ''}) — Jungle Bay Island`
    : 'Jungle Bay Island'
  const description = bungalow?.description
    ?? `View the bungalow for ${bungalow?.name ?? tokenAddress} on Jungle Bay Island.`
  const image = bungalow?.image_url ?? `${spaOrigin}/jungle-bay.jpg`

  logInfo('OG BOT', `ua="${userAgent?.slice(0, 40)}" chain=${chain} token=${tokenAddress}`)

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="Jungle Bay Island" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`)
})

// --- Static file serving (production) ---
// Serves the built frontend SPA from ../frontend/dist/
// In dev, Vite handles this via its proxy config.
const STATIC_ROOT = path.resolve(import.meta.dir, '../../frontend/dist')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

app.get('/*', async (c, next) => {
  const reqPath = new URL(c.req.url).pathname
  const filePath = path.join(STATIC_ROOT, reqPath === '/' ? 'index.html' : reqPath)

  const file = Bun.file(filePath)
  if (await file.exists()) {
    const contentType = getMimeType(filePath)
    c.header('Content-Type', contentType)
    c.header('Cache-Control', reqPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
    return c.body(await file.arrayBuffer())
  }

  // SPA fallback: serve index.html for any non-file route
  const indexFile = Bun.file(path.join(STATIC_ROOT, 'index.html'))
  if (await indexFile.exists()) {
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.body(await indexFile.arrayBuffer())
  }

  return next()
})

app.notFound((c) => c.json({
  error: 'Route not found',
  code: 'not_found',
  request_id: c.get('requestId') ?? null,
}, 404 as any))

app.onError((error, c) => {
  const requestId = c.get('requestId') ?? 'unknown'
  logError(
    'ERR',
    `request_id=${requestId} method=${c.req.method} path=${c.req.path} message=${error instanceof Error ? error.message : 'unknown'}`,
  )

  if (isApiError(error)) {
    return c.json({
      error: error.message,
      code: error.code,
      status: error.status,
      request_id: requestId,
      details: error.details ?? null,
    }, error.status as any)
  }

  logError(
    'ERR',
    `request_id=${requestId} ${error instanceof Error ? error.stack ?? error.message : 'unknown error object'}`,
  )
  return c.json({
    error: 'Internal server error',
    code: 'internal_error',
    status: 500,
    request_id: requestId,
  }, 500 as any)
})

function maskDbUrl(raw: string): string {
  return raw.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')
}

const G = '\x1b[32m'  // green
const C = '\x1b[36m'  // cyan
const D = '\x1b[2m'   // dim
const B = '\x1b[1m'   // bold
const R = '\x1b[0m'   // reset
const Y = '\x1b[33m'  // yellow
const RE = '\x1b[31m' // red

function statusDot(ok: boolean): string {
  return ok ? `${G}●${R}` : `${RE}●${R}`
}

async function logStartupStatus(): Promise<void> {
  const startedAt = Date.now()

  const [dbResult, baseHeadResult, ethHeadResult] = await Promise.allSettled([
    db`SELECT NOW()::text AS now`,
    publicClients.base.getBlockNumber(),
    publicClients.ethereum.getBlockNumber(),
  ])

  const dbOk = dbResult.status === 'fulfilled'
  const baseOk = baseHeadResult.status === 'fulfilled'
  const ethOk = ethHeadResult.status === 'fulfilled'
  const baseHead = baseOk ? (baseHeadResult as PromiseFulfilledResult<bigint>).value : null
  const ethHead = ethOk ? (ethHeadResult as PromiseFulfilledResult<bigint>).value : null
  const ms = Date.now() - startedAt

  const corsDisplay = CONFIG.CORS_ORIGIN.length > 50
    ? CONFIG.CORS_ORIGIN.slice(0, 47) + '...'
    : CONFIG.CORS_ORIGIN

  console.log('')
  console.log(`  ${G}${B}Jungle Bay Island${R}  ${D}v1.0${R}`)
  console.log(`  ${D}${'─'.repeat(40)}${R}`)
  console.log('')
  console.log(`  ${D}Server${R}     http://localhost:${B}${CONFIG.PORT}${R}`)
  console.log(`  ${D}Schema${R}     ${CONFIG.SCHEMA}`)
  console.log(`  ${D}CORS${R}       ${corsDisplay}`)
  console.log('')
  console.log(`  ${D}Connections${R}`)
  console.log(`  ${statusDot(dbOk)}  PostgreSQL   ${dbOk ? `${G}connected${R}` : `${RE}failed${R}`}`)
  console.log(`  ${statusDot(baseOk)}  Base RPC     ${baseOk ? `${G}block ${baseHead}${R}` : `${RE}failed${R}`}`)
  console.log(`  ${statusDot(ethOk)}  Ethereum RPC ${ethOk ? `${G}block ${ethHead}${R}` : `${RE}failed${R}`}`)
  console.log(`  ${statusDot(!!CONFIG.NEYNAR_API_KEY)}  Neynar       ${CONFIG.NEYNAR_API_KEY ? `${G}configured${R}` : `${Y}not set${R}`}`)
  console.log('')
  console.log(`  ${D}Routes${R}     /api/*  /skill.md  /:chain/:ca`)
  console.log(`  ${D}Agents${R}     POST /api/agents/register`)
  console.log(`  ${D}Health${R}     GET  /api/health`)
  console.log('')
  console.log(`  ${D}Ready in ${ms}ms${R}`)
  console.log('')

  if (!dbOk) {
    logWarn('BOOT', 'Database connection failed. API is up but data routes may error.')
  }
}

if (import.meta.main) {
  await logStartupStatus()
}

export default {
  port: CONFIG.PORT,
  fetch: app.fetch,
}
