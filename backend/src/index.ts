import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CONFIG, db, publicClients, normalizeAddress, toSupportedChain } from './config'
import { requestLogMiddleware } from './middleware/requestLog'
import { requestIdMiddleware } from './middleware/requestId'
import { createRateLimit } from './middleware/rateLimit'
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
import widgetRoute from './routes/widget'
import v1BungalowRoute from './routes/v1-bungalow'
import authRoute from './routes/auth'
import walletLinkRoute from './routes/wallet-link'
import { getBulletinPosts, getBungalow, getCustomBungalow, getTokenHolders, getTokenHeatDistribution, getUserByWallet, getLinkedWalletsByWallet } from './db/queries'
import { getCached, setCached } from './services/cache'
import { isApiError } from './services/errors'
import { logError, logInfo, logWarn } from './services/logger'
import { resolveTokenMetadata } from './services/tokenMetadata'
import { renderLanding, render404 } from './templates/landing'
import { renderBungalow } from './templates/bungalow'
import { renderUserPage } from './templates/user'
import { renderProfilePage } from './templates/profile'
import { getSessionFromRequest } from './services/session'
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

// Prevent stale caching on all responses
app.use('*', async (c, next) => {
  await next()
  // HTML pages: always revalidate
  const ct = c.res.headers.get('content-type') ?? ''
  if (ct.includes('text/html')) {
    c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    c.res.headers.set('Pragma', 'no-cache')
  }
  // API JSON: never cache
  if (c.req.path.startsWith('/api/') && !c.res.headers.has('Cache-Control')) {
    c.res.headers.set('Cache-Control', 'no-store')
  }
})

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
app.route('/api', widgetRoute)
app.route('/api', v1BungalowRoute)
app.route('/api', walletLinkRoute)
app.route('', authRoute)

// --- skill.md for AI agents ---
async function serveSkillMd(c: any) {
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
}
app.get('/skill.md', serveSkillMd)
app.get('/skill', serveSkillMd)
app.get('/api/skill', serveSkillMd)

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

  const tokenMeta = await resolveTokenMetadata(tokenAddress, supported)

  const spaOrigin = (process.env.CORS_ORIGIN ?? 'https://memetics.lat').split(',')[0].trim()
  const canonicalUrl = `${spaOrigin}/${chain}/${tokenAddress}`
  const title = tokenMeta.symbol
    ? `$${tokenMeta.symbol} ${tokenAddress} — Memetics`
    : `${tokenAddress} — Memetics`
  const description = tokenMeta.description
    ?? `View the bungalow for ${tokenMeta.name ?? tokenAddress} on Jungle Bay Island.`
  const image = tokenMeta.image_url ?? `${spaOrigin}/jungle-bay.jpg`

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

// --- Profile page (logged-in user) ---
app.get('/profile', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    return c.redirect('/auth/twitter?return=/profile')
  }

  // Fetch linked wallets
  let wallets: Array<{ wallet: string; wallet_kind: string; linked_at: string }> = []
  try {
    await db`ALTER TABLE ${db(CONFIG.SCHEMA)}.user_wallet_links ADD COLUMN IF NOT EXISTS x_id TEXT`
    wallets = await db<Array<{ wallet: string; wallet_kind: string; linked_at: string }>>`
      SELECT wallet, wallet_kind, first_seen_at::text AS linked_at
      FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
      WHERE x_id = ${session.x_id}
      ORDER BY first_seen_at ASC
    `
  } catch (err) {
    logError('PROFILE', `wallet query failed: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  logInfo('PROFILE PAGE', `x=@${session.x_username} wallets=${wallets.length}`)
  return c.html(renderProfilePage({ session, wallets }))
})

// --- User profile page ---
app.get('/user/:wallet', async (c) => {
  const rawWallet = c.req.param('wallet')
  const wallet = normalizeAddress(rawWallet) ?? normalizeAddress(rawWallet, 'solana') ?? rawWallet.trim()

  if (!wallet) {
    return c.html(render404(), 404 as any)
  }

  const [userData, userSession, linkedWallets] = await Promise.all([
    getUserByWallet(wallet),
    getSessionFromRequest(c.req.header('cookie')),
    getLinkedWalletsByWallet(wallet).catch(() => null),
  ])
  if (!userData) {
    return c.html(render404(), 404 as any)
  }

  logInfo('USER PAGE', `wallet=${wallet} heat=${userData.island_heat} tokens=${userData.token_breakdown.length} linked=${linkedWallets?.wallets?.length ?? 0}`)
  return c.html(renderUserPage({
    ...userData,
    session: userSession,
    linked_wallets: linkedWallets?.wallets ?? null,
    x_username: linkedWallets?.x_username ?? null,
  }))
})

// --- Landing page ---
app.get('/', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  return c.html(renderLanding(session))
})

// --- Bungalow page (human visitors) ---
// Fetches all data and renders server-side HTML with Memetics shell.
const CUSTOM_BUNGALOW_TTL = 10 * 60 * 1000 // 10 minutes

app.get('/:chain/:ca', async (c, next) => {
  const chain = c.req.param('chain')
  const ca = c.req.param('ca')

  if (!VALID_CHAINS.has(chain)) return next()

  const supported = toSupportedChain(chain)
  if (!supported) return next()

  const tokenAddress = normalizeAddress(ca, supported)
  if (!tokenAddress) return next()

  // Fetch all data in parallel
  const [bungalow, holdersResult, bulletinResult, customHtml, tokenMeta, heatDistribution, session] = await Promise.all([
    getBungalow(tokenAddress, supported),
    getTokenHolders(tokenAddress, 20, 0),
    getBulletinPosts(tokenAddress, 20, 0),
    (async () => {
      const cacheKey = `custom_bungalow:${chain}:${tokenAddress}`
      let html = getCached<string | false>(cacheKey)
      if (html === null) {
        const row = await getCustomBungalow(tokenAddress, chain)
        if (row) {
          html = row.html
          setCached(cacheKey, html, CUSTOM_BUNGALOW_TTL)
        } else {
          setCached(cacheKey, false, CUSTOM_BUNGALOW_TTL)
          html = false
        }
      }
      return html === false ? null : html
    })(),
    resolveTokenMetadata(tokenAddress, supported),
    getTokenHeatDistribution(tokenAddress),
    getSessionFromRequest(c.req.header('cookie')),
  ])

  logInfo('BUNGALOW PAGE', `chain=${chain} token=${tokenAddress} claimed=${bungalow?.is_claimed ?? false} custom=${!!customHtml}`)

  return c.html(renderBungalow({
    chain,
    tokenAddress,
    bungalow,
    customHtml,
    holders: holdersResult.holders,
    holderTotal: holdersResult.total,
    bulletinPosts: bulletinResult.posts,
    bulletinTotal: bulletinResult.total,
    fallbackName: tokenMeta.name,
    fallbackSymbol: tokenMeta.symbol,
    fallbackImage: tokenMeta.image_url,
    heatDistribution,
    session,
  }))
})

app.notFound((c) => {
  // API routes get JSON 404
  if (c.req.path.startsWith('/api/')) {
    return c.json({
      error: 'Route not found',
      code: 'not_found',
      request_id: c.get('requestId') ?? null,
    }, 404 as any)
  }
  // Everything else gets the branded 404 page
  return c.html(render404(), 404 as any)
})

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
  console.log(`  ${statusDot(!!CONFIG.TWITTER_CLIENT_ID)}  Twitter OAuth ${CONFIG.TWITTER_CLIENT_ID ? `${G}configured${R}` : `${Y}not set${R}`}`)
  console.log(`  ${statusDot(!!CONFIG.NEYNAR_API_KEY)}  Neynar       ${CONFIG.NEYNAR_API_KEY ? `${G}configured${R}` : `${Y}not set${R}`}`)
  console.log('')
  console.log(`  ${D}Routes${R}     /api/*  /skill.md  /:chain/:ca  /user/:wallet  /profile`)
  console.log(`  ${D}Auth${R}       /auth/twitter  /auth/callback  /auth/logout  /auth/me`)
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
