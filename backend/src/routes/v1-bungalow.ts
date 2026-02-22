import { Hono } from 'hono'
import { CONFIG, db, normalizeAddress } from '../config'
import { logInfo, logWarn } from '../services/logger'
import {
  verifyUsdcPayment,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  BUNGALOW_COST_USDC,
} from '../services/payment'

const v1BungalowRoute = new Hono()

const MAX_HTML_SIZE = 500 * 1024 // 500KB

let customBungalowTablePromise: Promise<void> | null = null

async function ensureCustomBungalowTable(): Promise<void> {
  if (!customBungalowTablePromise) {
    customBungalowTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.custom_bungalows (
          token_address TEXT NOT NULL,
          chain TEXT NOT NULL,
          html TEXT NOT NULL,
          title TEXT,
          description TEXT,
          html_url TEXT,
          deployer_address TEXT,
          deployer_tx_hash TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (token_address, chain)
        )
      `
      // Add columns if table already exists without them
      for (const col of ['title TEXT', 'description TEXT', 'html_url TEXT', 'deployer_address TEXT', 'deployer_tx_hash TEXT', 'deployed_at TIMESTAMPTZ DEFAULT NOW()', 'updated_at TIMESTAMPTZ DEFAULT NOW()']) {
        const [name] = col.split(' ')
        await db`
          ALTER TABLE ${db(CONFIG.SCHEMA)}.custom_bungalows
          ADD COLUMN IF NOT EXISTS ${db(name)} ${db.unsafe(col.slice(name.length + 1))}
        `.catch(() => {})
      }
    })()
  }
  await customBungalowTablePromise
}

// GET /api/treasury
v1BungalowRoute.get('/treasury', (c) => {
  return c.json({
    address: TREASURY_ADDRESS,
    chain: 'base',
    chain_id: 8453,
    usdc_contract: USDC_ADDRESS,
    bungalow_cost_usdc: BUNGALOW_COST_USDC,
  })
})

// POST /api/v1/bungalow — claim or deploy
// Two modes:
//   1. Claim only: { mint_address } — marks bungalow as claimed, no HTML needed
//   2. Deploy HTML: { mint_address, html_url, title } — fetches HTML and stores it
v1BungalowRoute.post('/v1/bungalow', async (c) => {
  await ensureCustomBungalowTable()

  const paymentSig = c.req.header('payment-signature') || c.req.header('Payment-Signature')

  if (!paymentSig) {
    return c.json({
      error: 'payment required',
      cost_usdc: BUNGALOW_COST_USDC,
      treasury: TREASURY_ADDRESS,
      chain: 'base',
      chain_id: 8453,
      usdc_contract: USDC_ADDRESS,
      accepts: ['x402', 'raw_tx_hash'],
    }, 402 as any)
  }

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400 as any)
  }

  const { mint_address, html_url, title, description } = body

  if (!mint_address || typeof mint_address !== 'string') {
    return c.json({ error: 'mint_address is required' }, 400 as any)
  }

  // Determine chain — Solana base58 check
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint_address.trim())
  const chain = isSolana ? 'solana' : 'base'
  const tokenAddress = normalizeAddress(mint_address.trim(), chain as any)

  if (!tokenAddress) {
    return c.json({ error: 'Invalid mint_address format' }, 400 as any)
  }

  // Verify payment
  const txHash = paymentSig.startsWith('0x') ? paymentSig : `0x${paymentSig}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return c.json({ error: 'Invalid payment-signature format. Expected 0x + 64 hex chars.' }, 400 as any)
  }

  const payment = await verifyUsdcPayment(txHash, tokenAddress)
  if (!payment.valid) {
    return c.json({ error: payment.error }, 402 as any)
  }

  const deployer = payment.from ?? null

  // If html_url is provided, fetch and store the HTML (agent/update flow)
  if (html_url && typeof html_url === 'string') {
    if (!isRawUrl(html_url)) {
      return c.json({
        error: 'html_url must be a raw file URL (e.g. https://gist.githubusercontent.com/.../raw/...)',
        hint: 'Use the "Raw" button on GitHub Gist to get the direct URL to the file content',
      }, 400 as any)
    }

    let html: string
    try {
      const resp = await fetch(html_url, {
        headers: { 'Accept': 'text/html, text/plain, */*' },
        signal: AbortSignal.timeout(10_000),
      })

      if (!resp.ok) {
        return c.json({ error: `Failed to fetch HTML from URL: ${resp.status} ${resp.statusText}` }, 400 as any)
      }

      html = await resp.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: `Failed to fetch HTML: ${msg}` }, 400 as any)
    }

    if (html.length > MAX_HTML_SIZE) {
      return c.json({ error: `HTML too large (${Math.round(html.length / 1024)}KB). Max is 500KB.` }, 400 as any)
    }

    if (!html.includes('<html') && !html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
      return c.json({ error: 'Content does not appear to be valid HTML. Must contain <html> or <!DOCTYPE html>.' }, 400 as any)
    }

    // Upsert into custom_bungalows
    await db`
      INSERT INTO ${db(CONFIG.SCHEMA)}.custom_bungalows (
        token_address, chain, html, title, description, html_url,
        deployer_address, deployer_tx_hash, is_active, deployed_at, updated_at
      )
      VALUES (
        ${tokenAddress}, ${chain}, ${html}, ${title ?? null}, ${description ?? null}, ${html_url},
        ${deployer}, ${txHash}, TRUE, NOW(), NOW()
      )
      ON CONFLICT (token_address, chain)
      DO UPDATE SET
        html = EXCLUDED.html,
        title = COALESCE(EXCLUDED.title, ${db(CONFIG.SCHEMA)}.custom_bungalows.title),
        description = COALESCE(EXCLUDED.description, ${db(CONFIG.SCHEMA)}.custom_bungalows.description),
        html_url = EXCLUDED.html_url,
        deployer_address = COALESCE(EXCLUDED.deployer_address, ${db(CONFIG.SCHEMA)}.custom_bungalows.deployer_address),
        deployer_tx_hash = EXCLUDED.deployer_tx_hash,
        is_active = TRUE,
        updated_at = NOW()
    `
  }

  // Mark bungalow as claimed
  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
      token_address, chain, name, is_claimed, current_owner, updated_at
    )
    VALUES (
      ${tokenAddress}, ${chain}, ${title ?? null}, TRUE, ${deployer}, NOW()
    )
    ON CONFLICT (token_address)
    DO UPDATE SET
      name = COALESCE(EXCLUDED.name, ${db(CONFIG.SCHEMA)}.bungalows.name),
      is_claimed = TRUE,
      current_owner = COALESCE(EXCLUDED.current_owner, ${db(CONFIG.SCHEMA)}.bungalows.current_owner),
      updated_at = NOW()
  `

  const url = `https://memetics.wtf/${chain}/${tokenAddress}`

  logInfo('BUNGALOW CLAIM', `chain=${chain} token=${tokenAddress} deployer=${deployer} hasHtml=${!!html_url} tx=${txHash.slice(0, 10)}...`)

  return c.json({
    ok: true,
    mint_address: tokenAddress,
    url,
    has_custom_html: !!html_url,
    deployed_at: new Date().toISOString(),
  }, 201 as any)
})

// GET /api/v1/bungalow/:mint_address
v1BungalowRoute.get('/v1/bungalow/:mint_address', async (c) => {
  await ensureCustomBungalowTable()

  const mintAddress = c.req.param('mint_address')
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress.trim())
  const chain = isSolana ? 'solana' : 'base'
  const tokenAddress = normalizeAddress(mintAddress.trim(), chain as any)

  if (!tokenAddress) {
    return c.json({ error: 'Invalid mint address' }, 400 as any)
  }

  const rows = await db<{
    token_address: string
    chain: string
    title: string | null
    description: string | null
    html_url: string | null
    deployed_at: string | null
    updated_at: string | null
  }[]>`
    SELECT token_address, chain, title, description, html_url,
           deployed_at::text AS deployed_at, updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.custom_bungalows
    WHERE token_address = ${tokenAddress} AND chain = ${chain} AND is_active = TRUE
    LIMIT 1
  `

  if (rows.length === 0) {
    return c.json({ error: 'Bungalow not found' }, 404 as any)
  }

  const row = rows[0]
  return c.json({
    mint_address: row.token_address,
    chain: row.chain,
    title: row.title,
    description: row.description,
    url: `https://memetics.wtf/${row.chain}/${row.token_address}`,
    deployed_at: row.deployed_at,
    updated_at: row.updated_at,
  })
})

function isRawUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.hostname === 'gist.githubusercontent.com') return true
    if (u.hostname === 'raw.githubusercontent.com') return true
    if (u.hostname.endsWith('.githubusercontent.com') && u.pathname.includes('/raw/')) return true
    if (u.pathname.includes('/raw/') || u.pathname.includes('/raw')) return true
    if (u.pathname.endsWith('.html') || u.pathname.endsWith('.htm')) return true
    return false
  } catch {
    return false
  }
}

export default v1BungalowRoute
