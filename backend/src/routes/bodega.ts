import { Hono } from 'hono'
import {
  CONFIG,
  db,
  normalizeAddress,
  toSupportedChain,
  type SupportedChain,
} from '../config'
import {
  createBodegaInstall,
  createBonusHeatEvent,
  createCatalogItem,
  getBodegaInstallsByBungalow,
  getCatalogItem,
  getCatalogItemBySubmissionTxHash,
  getCatalogItems,
  getCatalogItemsByCreator,
  getIdentityClusterByWallet,
  getUnclaimedCreatorCredits,
  incrementInstallCount,
} from '../db/queries'
import { optionalWalletContext } from '../middleware/auth'
import { getCanonicalProjectContext } from '../services/canonicalProjects'
import { ApiError } from '../services/errors'
import type { AppEnv } from '../types'

const bodegaRoute = new Hono<AppEnv>()

const REWARD_RESET_HOUR_UTC = 12
const REWARD_RESET_OFFSET_SECONDS = REWARD_RESET_HOUR_UTC * 3600
const BODEGA_SUBMISSION_FEE = 69_000n
const VALID_ASSET_TYPES = new Set(['decoration', 'miniapp', 'game', 'link', 'image'])
const VALID_DECORATION_FORMATS = new Set(['image', 'glb', 'usdz'])

interface BodegaSubmitBody {
  creator_wallet?: unknown
  asset_type?: unknown
  title?: unknown
  description?: unknown
  content?: unknown
  preview_url?: unknown
  price_in_jbm?: unknown
  tx_hash?: unknown
  jbm_amount?: unknown
  origin_bungalow_token_address?: unknown
  origin_bungalow_chain?: unknown
}

interface BodegaInstallBody {
  installed_by_wallet?: unknown
  catalog_item_id?: unknown
  installed_to_token_address?: unknown
  installed_to_chain?: unknown
  tx_hash?: unknown
  jbm_amount?: unknown
}

/**
 * Ensures a JSON payload is an object before type-specific validation runs.
 */
function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

/**
 * Normalizes arbitrary input into a trimmed string so route validation stays predictable.
 */
function asString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

/**
 * Accepts both EVM and Solana wallet shapes because creator records may expand beyond one chain.
 */
function normalizeWallet(input: unknown): string | null {
  const raw = asString(input)
  if (!raw) return null
  return normalizeAddress(raw) ?? normalizeAddress(raw, 'solana')
}

/**
 * Verifies HTTP(S) URLs so catalog content stays renderable in the web client.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Parses positive numeric input as a string so Postgres NUMERIC can keep exact precision.
 */
function parsePositiveNumericString(input: unknown, fieldName: string): string {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive number`)
  }

  const raw = String(input).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive number`)
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive number`)
  }

  return raw
}

/**
 * Parses whole-number JBM amounts for payment proofs so fixed-fee flows cannot send decimals.
 */
function parseWholeJbmAmount(input: unknown, fieldName: string): bigint {
  const raw = asString(input)
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a whole-number JBM amount`)
  }

  try {
    const value = BigInt(raw)
    if (value <= 0n) {
      throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive JBM amount`)
    }
    return value
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a whole-number JBM amount`)
  }
}

/**
 * Validates transaction hashes before install rows are written.
 */
function validateTxHash(input: unknown): string {
  const txHash = asString(input)
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }
  return txHash
}

/**
 * Validates optional origin bungalow fields and normalizes them for storage.
 */
function parseOriginBungalow(input: {
  origin_bungalow_token_address?: unknown
  origin_bungalow_chain?: unknown
}): {
  token_address: string | null
  chain: SupportedChain | null
} {
  const rawChain = asString(input.origin_bungalow_chain)
  const rawToken = asString(input.origin_bungalow_token_address)

  if (!rawChain && !rawToken) {
    return { token_address: null, chain: null }
  }

  const chain = toSupportedChain(rawChain)
  if (!chain) {
    throw new ApiError(400, 'invalid_origin_bungalow', 'origin_bungalow_chain must be base, ethereum, or solana')
  }

  const tokenAddress = normalizeAddress(rawToken, chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_origin_bungalow', 'origin_bungalow_token_address is invalid for the selected chain')
  }

  return {
    token_address: tokenAddress,
    chain,
  }
}

/**
 * Validates Bodega content payloads so each asset type keeps a renderable shape.
 */
function normalizeBodegaContent(
  assetType: string,
  input: unknown,
): Record<string, unknown> {
  const content = asObject(input)
  if (!content) {
    throw new ApiError(400, 'invalid_content', 'content must be a JSON object')
  }

  if (assetType === 'decoration') {
    const previewUrl = asString(content.preview_url)
    const externalUrl = asString(content.external_url) || previewUrl
    const format = asString(content.format).toLowerCase()
    if (!previewUrl || !isHttpUrl(previewUrl)) {
      throw new ApiError(400, 'invalid_content', 'decoration content.preview_url must be a valid http(s) URL')
    }
    if (!isHttpUrl(externalUrl)) {
      throw new ApiError(400, 'invalid_content', 'decoration content.external_url must be a valid http(s) URL')
    }
    if (!VALID_DECORATION_FORMATS.has(format)) {
      throw new ApiError(400, 'invalid_content', 'decoration content.format must be image, glb, or usdz')
    }
    return {
      preview_url: previewUrl,
      external_url: externalUrl,
      format,
    }
  }

  if (assetType === 'miniapp' || assetType === 'game') {
    const url = asString(content.url)
    const name = asString(content.name)
    const description = asString(content.description)
    if (!url || !isHttpUrl(url)) {
      throw new ApiError(400, 'invalid_content', `${assetType} content.url must be a valid http(s) URL`)
    }
    if (!name) {
      throw new ApiError(400, 'invalid_content', `${assetType} content.name is required`)
    }
    return {
      url,
      name,
      description,
    }
  }

  if (assetType === 'link') {
    const url = asString(content.url)
    const title = asString(content.title)
    if (!url || !isHttpUrl(url)) {
      throw new ApiError(400, 'invalid_content', 'link content.url must be a valid http(s) URL')
    }
    if (!title) {
      throw new ApiError(400, 'invalid_content', 'link content.title is required')
    }
    return {
      url,
      title,
    }
  }

  const imageUrl = asString(content.image_url)
  const caption = asString(content.caption)
  if (!imageUrl || !isHttpUrl(imageUrl)) {
    throw new ApiError(400, 'invalid_content', 'image content.image_url must be a valid http(s) URL')
  }
  return {
    image_url: imageUrl,
    caption,
  }
}

/**
 * Derives a cached creator handle from Farcaster profile lookups when available.
 */
async function getCreatorHandle(wallet: string): Promise<string | null> {
  const rows = await db<Array<{ username: string | null }>>`
    SELECT username
    FROM ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles
    WHERE wallet = ${wallet}
    LIMIT 1
  `

  return rows[0]?.username ?? null
}

/**
 * Resolves a bungalow input to the canonical primary deployment so heat and claims stay project-aligned.
 */
async function getClosestBungalowDeployment(
  chain: SupportedChain,
  tokenAddress: string,
): Promise<{ chain: SupportedChain; token_address: string }> {
  const projectContext = await getCanonicalProjectContext(chain, tokenAddress)
  return projectContext.primaryDeployment
}

/**
 * Uses the same reward reset boundary as claims.ts so creator credits line up with claim periods.
 */
function getClaimPeriodId(nowMs = Date.now()): number {
  const unix = Math.floor(nowMs / 1000)
  return Math.floor((unix - REWARD_RESET_OFFSET_SECONDS) / 86400)
}

/**
 * Ensures the shared claims allocation table exists before Bodega credits write into it.
 */
async function ensureClaimRewardsTable(): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.claim_daily_allocations (
      id BIGSERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL,
      identity_source TEXT NOT NULL,
      identity_value TEXT NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      period_id INTEGER NOT NULL,
      heat_degrees NUMERIC NOT NULL DEFAULT 0,
      reward_jbm NUMERIC NOT NULL DEFAULT 0,
      wallets_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      claimant_wallet TEXT,
      claim_nonce INTEGER,
      signature TEXT,
      amount_wei NUMERIC,
      deadline INTEGER,
      CONSTRAINT claim_daily_identity_period_unique
        UNIQUE (identity_key, chain, token_address, period_id)
    )
  `

  await db`
    CREATE INDEX IF NOT EXISTS idx_claim_daily_identity
    ON ${db(CONFIG.SCHEMA)}.claim_daily_allocations (identity_key, period_id DESC)
  `

  await db`
    CREATE INDEX IF NOT EXISTS idx_claim_daily_token
    ON ${db(CONFIG.SCHEMA)}.claim_daily_allocations (chain, token_address, period_id DESC)
  `
}

/**
 * Chooses the token context that should own creator revenue, preferring the source bungalow when available.
 */
async function resolveCreatorCreditContext(input: {
  catalogItem: Awaited<ReturnType<typeof getCatalogItem>>
  installedToChain: SupportedChain
  installedToTokenAddress: string
}): Promise<{ chain: SupportedChain; token_address: string }> {
  if (
    input.catalogItem?.origin_bungalow_chain &&
    input.catalogItem.origin_bungalow_token_address
  ) {
    return getClosestBungalowDeployment(
      input.catalogItem.origin_bungalow_chain,
      input.catalogItem.origin_bungalow_token_address,
    )
  }

  return getClosestBungalowDeployment(
    input.installedToChain,
    input.installedToTokenAddress,
  )
}

/**
 * Upserts creator revenue into the shared claims allocation ledger using the existing claims row shape.
 */
async function upsertCreatorClaimAllocation(input: {
  creatorWallet: string
  amountJbm: string
  chain: SupportedChain
  tokenAddress: string
}): Promise<void> {
  await ensureClaimRewardsTable()

  const identity = await getIdentityClusterByWallet(input.creatorWallet)
  const identityKey = identity?.identity_key ?? `wallet:${input.creatorWallet}`
  const identitySource = identity?.identity_source ?? 'wallet'
  const identityValue = identity?.identity_value ?? input.creatorWallet
  const periodId = getClaimPeriodId()

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.claim_daily_allocations (
      identity_key,
      identity_source,
      identity_value,
      chain,
      token_address,
      period_id,
      heat_degrees,
      reward_jbm,
      wallets_snapshot
    )
    VALUES (
      ${identityKey},
      ${identitySource},
      ${identityValue},
      ${input.chain},
      ${input.tokenAddress},
      ${periodId},
      0,
      ${input.amountJbm},
      ${JSON.stringify([{ wallet: input.creatorWallet, heat_degrees: 0 }])}::jsonb
    )
    ON CONFLICT (identity_key, chain, token_address, period_id)
    DO UPDATE SET
      reward_jbm = ${db(CONFIG.SCHEMA)}.claim_daily_allocations.reward_jbm + EXCLUDED.reward_jbm,
      wallets_snapshot = EXCLUDED.wallets_snapshot
  `
}

// ── Submit ───────────────────────────────────────────────────

bodegaRoute.post('/submit', optionalWalletContext, async (c) => {
  const body = await c.req.json<BodegaSubmitBody>()
  const creatorWallet =
    normalizeWallet(body.creator_wallet) ?? c.get('walletAddress') ?? null
  if (!creatorWallet) {
    throw new ApiError(
      400,
      'invalid_wallet',
      'creator_wallet is required when wallet authentication is unavailable',
    )
  }

  const assetType = asString(body.asset_type).toLowerCase()
  if (!VALID_ASSET_TYPES.has(assetType)) {
    throw new ApiError(400, 'invalid_asset_type', 'asset_type must be one of: decoration, miniapp, game, link, image')
  }

  const title = asString(body.title)
  if (!title) {
    throw new ApiError(400, 'invalid_title', 'title is required')
  }

  const normalizedContent = normalizeBodegaContent(assetType, body.content)
  const priceInJbm = parsePositiveNumericString(body.price_in_jbm, 'price_in_jbm')
  const submissionTxHash = validateTxHash(body.tx_hash)
  const submissionFee = parseWholeJbmAmount(body.jbm_amount, 'jbm_amount')
  if (submissionFee !== BODEGA_SUBMISSION_FEE) {
    throw new ApiError(
      400,
      'invalid_submission_fee',
      `jbm_amount must equal ${BODEGA_SUBMISSION_FEE.toString()} for Bodega submissions`,
    )
  }
  const origin = parseOriginBungalow(body)
  const creatorHandle = await getCreatorHandle(creatorWallet)
  const existingItem = await getCatalogItemBySubmissionTxHash(submissionTxHash)
  if (existingItem) {
    if (existingItem.creator_wallet !== creatorWallet) {
      throw new ApiError(409, 'duplicate_tx_hash', 'tx_hash has already been used')
    }
    return c.json({ item: existingItem })
  }
  const previewUrl = (() => {
    const explicitPreview = asString(body.preview_url)
    if (explicitPreview) {
      if (!isHttpUrl(explicitPreview)) {
        throw new ApiError(400, 'invalid_preview_url', 'preview_url must be a valid http(s) URL')
      }
      return explicitPreview
    }

    if (assetType === 'decoration') {
      return asString(normalizedContent.preview_url)
    }

    if (assetType === 'image') {
      return asString(normalizedContent.image_url)
    }

    return null
  })()

  const item = await createCatalogItem({
    creator_wallet: creatorWallet,
    creator_handle: creatorHandle,
    origin_bungalow_token_address: origin.token_address,
    origin_bungalow_chain: origin.chain,
    asset_type: assetType as 'decoration' | 'miniapp' | 'game' | 'link' | 'image',
    title,
    description: asString(body.description) || null,
    content: normalizedContent,
    preview_url: previewUrl,
    price_in_jbm: priceInJbm,
    submission_tx_hash: submissionTxHash,
    submission_fee_jbm: submissionFee.toString(),
  })

  if (origin.chain && origin.token_address) {
    const bonusTarget = await getClosestBungalowDeployment(origin.chain, origin.token_address)
    await createBonusHeatEvent({
      wallet: creatorWallet,
      token_address: bonusTarget.token_address,
      chain: bonusTarget.chain,
      event_type: 'bodega_submission',
      bonus_points: 5,
    })
  }

  return c.json({ item }, 201)
})

// ── Catalog ─────────────────────────────────────────────────

bodegaRoute.get('/catalog', async (c) => {
  const rawAssetType = asString(c.req.query('asset_type'))
  const assetType = rawAssetType ? rawAssetType.toLowerCase() : ''
  if (assetType && !VALID_ASSET_TYPES.has(assetType)) {
    throw new ApiError(400, 'invalid_asset_type', 'asset_type must be one of: decoration, miniapp, game, link, image')
  }

  const rawCreatorWallet = c.req.query('creator_wallet')
  const creatorWallet = rawCreatorWallet
    ? normalizeWallet(rawCreatorWallet)
    : null
  if (rawCreatorWallet && !creatorWallet) {
    throw new ApiError(400, 'invalid_wallet', 'creator_wallet must be a valid wallet address')
  }

  const limitRaw = Number.parseInt(c.req.query('limit') ?? '20', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : 20
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(offsetRaw, 0)
    : 0

  const items = await getCatalogItems(
    {
      asset_type: assetType
        ? (assetType as 'decoration' | 'miniapp' | 'game' | 'link' | 'image')
        : undefined,
      creator_wallet: creatorWallet ?? undefined,
      active: true,
    },
    limit,
    offset,
  )

  return c.json({
    items,
    limit,
    offset,
    count: items.length,
  })
})

bodegaRoute.get('/catalog/creator/:wallet', async (c) => {
  const wallet = normalizeWallet(c.req.param('wallet'))
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const items = await getCatalogItemsByCreator(wallet)
  return c.json({ wallet, items })
})

bodegaRoute.get('/catalog/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError(400, 'invalid_catalog_item', 'Catalog item id must be a positive integer')
  }

  const item = await getCatalogItem(id)
  if (!item) {
    throw new ApiError(404, 'catalog_item_not_found', 'Catalog item not found')
  }

  return c.json({ item })
})

// ── Install ────────────────────────────────────────────────

bodegaRoute.post('/install', optionalWalletContext, async (c) => {
  const body = await c.req.json<BodegaInstallBody>()
  const installedByWallet =
    normalizeWallet(body.installed_by_wallet) ?? c.get('walletAddress') ?? null
  if (!installedByWallet) {
    throw new ApiError(
      400,
      'invalid_wallet',
      'installed_by_wallet is required when wallet authentication is unavailable',
    )
  }

  const catalogItemId = Number.parseInt(String(body.catalog_item_id ?? ''), 10)
  if (!Number.isFinite(catalogItemId) || catalogItemId <= 0) {
    throw new ApiError(400, 'invalid_catalog_item', 'catalog_item_id must be a positive integer')
  }

  const installedToChain = toSupportedChain(asString(body.installed_to_chain))
  if (!installedToChain) {
    throw new ApiError(400, 'invalid_chain', 'installed_to_chain must be base, ethereum, or solana')
  }

  const installedToTokenAddress = normalizeAddress(
    asString(body.installed_to_token_address),
    installedToChain,
  )
  if (!installedToTokenAddress) {
    throw new ApiError(400, 'invalid_token', 'installed_to_token_address is invalid for the selected chain')
  }

  const txHash = validateTxHash(body.tx_hash)
  const jbmAmount = parsePositiveNumericString(body.jbm_amount, 'jbm_amount')

  const catalogItem = await getCatalogItem(catalogItemId)
  if (!catalogItem || !catalogItem.active) {
    throw new ApiError(404, 'catalog_item_not_found', 'Catalog item is missing or inactive')
  }

  const priceCheck = await db<Array<{ enough: boolean }>>`
    SELECT (${jbmAmount}::numeric >= ${catalogItem.price_in_jbm}::numeric) AS enough
  `
  if (!priceCheck[0]?.enough) {
    throw new ApiError(400, 'insufficient_jbm_amount', 'jbm_amount must match or exceed the catalog item price')
  }

  const duplicateRows = await db<Array<{ id: number }>>`
    SELECT id
    FROM ${db(CONFIG.SCHEMA)}.bodega_installs
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `
  if (duplicateRows.length > 0) {
    throw new ApiError(409, 'duplicate_tx_hash', 'tx_hash has already been used')
  }

  const install = await createBodegaInstall({
    catalog_item_id: catalogItemId,
    installed_to_token_address: installedToTokenAddress,
    installed_to_chain: installedToChain,
    installed_by_wallet: installedByWallet,
    tx_hash: txHash,
    jbm_amount: jbmAmount,
  })

  await incrementInstallCount(catalogItemId)

  const installBonusTarget = await getClosestBungalowDeployment(
    installedToChain,
    installedToTokenAddress,
  )
  await createBonusHeatEvent({
    wallet: installedByWallet,
    token_address: installBonusTarget.token_address,
    chain: installBonusTarget.chain,
    event_type: 'bodega_install',
    bonus_points: 3,
  })

  const creatorCreditContext = await resolveCreatorCreditContext({
    catalogItem,
    installedToChain,
    installedToTokenAddress,
  })
  await upsertCreatorClaimAllocation({
    creatorWallet: catalogItem.creator_wallet,
    amountJbm: install.creator_credit_jbm,
    chain: creatorCreditContext.chain,
    tokenAddress: creatorCreditContext.token_address,
  })

  return c.json({ install }, 201)
})

// ── Installs ───────────────────────────────────────────────

bodegaRoute.get('/installs/:chain/:token_address', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('token_address'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const installs = await getBodegaInstallsByBungalow(tokenAddress, chain)
  return c.json({
    chain,
    token_address: tokenAddress,
    installs,
  })
})

// ── Credits ────────────────────────────────────────────────

bodegaRoute.get('/credits/:wallet', async (c) => {
  const wallet = normalizeWallet(c.req.param('wallet'))
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const credits = await getUnclaimedCreatorCredits(wallet)
  return c.json({
    wallet,
    total_jbm: credits.total_jbm,
    installs: credits.installs,
  })
})

export default bodegaRoute
