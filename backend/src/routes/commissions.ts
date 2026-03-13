import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { parseUnits } from 'viem'
import {
  CONFIG,
  db,
  normalizeAddress,
  publicClients,
  toSupportedChain,
  type SupportedChain,
} from '../config'
import type { CommissionApplicationRow, CommissionRecordRow } from '../db/schema'
import {
  getBungalow,
  getTokenRegistry,
  getUserWallets,
} from '../db/queries'
import { optionalWalletContext, requirePrivyAuth } from '../middleware/auth'
import { getCanonicalProjectContext } from '../services/canonicalProjects'
import { ApiError } from '../services/errors'
import {
  computeMemeticsPrimaryAssetKey,
  decodeCommissionManagerLog,
  findMemeticsProfileByWallets,
  getCommissionManagerContractAddress,
  inferMemeticsAssetKind,
  readCommissionManagerApplications,
  readCommissionManagerCommission,
  readMemeticsBungalowIdByAssetKey,
  readMemeticsProfile,
  readWalletProfileId,
  toMemeticsAssetChain,
} from '../services/memetics'
import { getRequestSiteUrl } from '../services/siteMeta'
import type { AppEnv } from '../types'

const commissionsRoute = new Hono<AppEnv>()

const REVIEW_WINDOW_SECONDS = 3 * 24 * 60 * 60
const MAX_CLAIM_WINDOW_SECONDS = 7 * 24 * 60 * 60
const CLAIM_BUFFER_SECONDS = 24 * 60 * 60
const MIN_DELIVERY_WINDOW_SECONDS = 2 * 24 * 60 * 60
const MAX_RATE_LABEL_LENGTH = 80
const MAX_PROMPT_LENGTH = 4000
const MAX_APPLICATION_MESSAGE_LENGTH = 1000
const MAX_URI_LENGTH = 512

let commissionsShapePromise: Promise<void> | null = null

type CommissionStatus =
  | 'draft'
  | 'open'
  | 'selected'
  | 'claimed'
  | 'submitted'
  | 'disputed'
  | 'completed'
  | 'cancelled'

interface ViewerContext {
  privyUserId: string | null
  wallets: `0x${string}`[]
  profileId: number | null
}

interface ApplicationCountRow {
  commission_id: number
  applications_count: number
  pending_applications: number
}

interface ViewerApplicationRow {
  commission_id: number
  application_id: number
  status: CommissionApplicationRow['status']
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  return input as Record<string, unknown>
}

function asString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function asOptionalString(input: unknown, maxLength: number): string | null {
  const value = asString(input)
  if (!value) return null
  if (value.length > maxLength) {
    throw new ApiError(400, 'invalid_input', `Value exceeds ${maxLength} characters`)
  }
  return value
}

function asPositiveInt(input: string | null | undefined): number {
  const value = Number.parseInt((input ?? '').trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function createBriefId(): string {
  return randomBytes(16).toString('hex')
}

function createApplicationRef(): string {
  return randomBytes(16).toString('hex')
}

function normalizeBudgetInput(input: unknown): string {
  const value = asString(input)
  if (!/^\d+(\.\d{1,18})?$/.test(value)) {
    throw new ApiError(400, 'invalid_budget', 'Budget must be a valid JBM amount')
  }

  const normalized = value.replace(/^0+(?=\d)/, '')
  const candidate = normalized.startsWith('.') ? `0${normalized}` : normalized
  if (!candidate || candidate === '0' || candidate === '0.0') {
    throw new ApiError(400, 'invalid_budget', 'Budget must be greater than zero')
  }

  parseUnits(candidate, 18)
  return candidate
}

function parseDeliveryDeadline(input: unknown): { iso: string; unix: number } {
  const raw = asString(input)
  if (!raw) {
    throw new ApiError(400, 'invalid_deadline', 'Delivery deadline is required')
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'invalid_deadline', 'Delivery deadline must be a valid date')
  }

  const unix = Math.floor(parsed.getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  if (unix <= now + MIN_DELIVERY_WINDOW_SECONDS) {
    throw new ApiError(
      400,
      'invalid_deadline',
      'Delivery deadline must be at least 48 hours in the future',
    )
  }

  return {
    iso: parsed.toISOString(),
    unix,
  }
}

function deriveClaimDeadline(deliveryDeadlineUnix: number): number {
  const now = Math.floor(Date.now() / 1000)
  const latestClaim = deliveryDeadlineUnix - CLAIM_BUFFER_SECONDS
  const preferredClaim = now + MAX_CLAIM_WINDOW_SECONDS
  const claimDeadline = Math.min(latestClaim, preferredClaim)

  if (claimDeadline <= now) {
    throw new ApiError(
      400,
      'invalid_deadline',
      'Delivery deadline must leave time for artist selection and claiming',
    )
  }

  return claimDeadline
}

function normalizeCommissionStatus(statusCode: number): CommissionStatus {
  switch (statusCode) {
    case 1:
      return 'selected'
    case 2:
      return 'claimed'
    case 3:
      return 'submitted'
    case 4:
      return 'disputed'
    case 5:
      return 'completed'
    case 6:
      return 'cancelled'
    default:
      return 'open'
  }
}

function normalizeApplicationStatus(statusCode: number): CommissionApplicationRow['status'] {
  switch (statusCode) {
    case 1:
      return 'pending'
    case 2:
      return 'withdrawn'
    case 3:
      return 'selected'
    case 4:
      return 'accepted'
    case 5:
      return 'rejected'
    case 6:
      return 'expired'
    default:
      return 'draft'
  }
}

function normalizeCommissionRow(row: CommissionRecordRow, extras?: {
  applicationsCount?: number
  pendingApplications?: number
  viewerApplication?: { id: number; status: CommissionApplicationRow['status'] } | null
}) {
  return {
    brief_id: row.brief_id,
    commission_id: row.commission_id,
    requester_privy_user_id: row.requester_privy_user_id,
    requester_wallet: row.requester_wallet,
    requester_profile_id: row.requester_profile_id,
    requester_handle: row.requester_handle,
    bungalow_chain: row.bungalow_chain,
    bungalow_token_address: row.bungalow_token_address,
    bungalow_name: row.bungalow_name,
    rate_label: row.rate_label,
    prompt: row.prompt,
    brief_uri: row.brief_uri,
    budget_jbm: row.budget_jbm,
    claim_deadline: row.claim_deadline,
    delivery_deadline: row.delivery_deadline,
    status: row.status,
    created_tx_hash: row.created_tx_hash,
    approved_application_id: row.approved_application_id,
    approved_artist_wallet: row.approved_artist_wallet,
    approved_artist_profile_id: row.approved_artist_profile_id,
    approved_artist_handle: row.approved_artist_handle,
    artist_wallet: row.artist_wallet,
    artist_profile_id: row.artist_profile_id,
    artist_handle: row.artist_handle,
    claimed_tx_hash: row.claimed_tx_hash,
    submitted_tx_hash: row.submitted_tx_hash,
    approved_tx_hash: row.approved_tx_hash,
    cancelled_tx_hash: row.cancelled_tx_hash,
    payout_claim_tx_hash: row.payout_claim_tx_hash,
    deliverable_uri: row.deliverable_uri,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    applications_count: extras?.applicationsCount ?? 0,
    pending_applications: extras?.pendingApplications ?? 0,
    viewer_application: extras?.viewerApplication
      ? {
          id: extras.viewerApplication.id,
          status: extras.viewerApplication.status,
        }
      : null,
  }
}

function normalizeApplicationRow(row: CommissionApplicationRow) {
  return {
    id: row.application_id ?? row.id,
    application_ref: row.application_ref,
    application_uri: row.application_uri,
    commission_id: row.commission_id,
    artist_privy_user_id: row.artist_privy_user_id,
    artist_wallet: row.artist_wallet,
    artist_profile_id: row.artist_profile_id,
    artist_handle: row.artist_handle,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function ensureCommissionsShape(): Promise<void> {
  if (!commissionsShapePromise) {
    commissionsShapePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.commission_records (
          brief_id TEXT PRIMARY KEY,
          commission_id BIGINT UNIQUE,
          requester_privy_user_id TEXT NOT NULL,
          requester_wallet TEXT NOT NULL,
          requester_profile_id BIGINT,
          requester_handle TEXT,
          bungalow_chain TEXT NOT NULL,
          bungalow_token_address TEXT NOT NULL,
          bungalow_name TEXT,
          rate_label TEXT NOT NULL,
          prompt TEXT NOT NULL,
          brief_uri TEXT NOT NULL UNIQUE,
          budget_jbm NUMERIC NOT NULL,
          claim_deadline TIMESTAMPTZ NOT NULL,
          delivery_deadline TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_tx_hash TEXT UNIQUE,
          approved_application_id BIGINT,
          approved_artist_wallet TEXT,
          approved_artist_profile_id BIGINT,
          approved_artist_handle TEXT,
          artist_wallet TEXT,
          artist_profile_id BIGINT,
          artist_handle TEXT,
          claimed_tx_hash TEXT UNIQUE,
          submitted_tx_hash TEXT UNIQUE,
          approved_tx_hash TEXT UNIQUE,
          cancelled_tx_hash TEXT UNIQUE,
          payout_claim_tx_hash TEXT UNIQUE,
          deliverable_uri TEXT,
          submitted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `

      for (const definition of [
        'commission_id BIGINT UNIQUE',
        'requester_profile_id BIGINT',
        'requester_handle TEXT',
        'bungalow_chain TEXT',
        'bungalow_token_address TEXT',
        'bungalow_name TEXT',
        'rate_label TEXT',
        'prompt TEXT',
        'brief_uri TEXT',
        'budget_jbm NUMERIC',
        'claim_deadline TIMESTAMPTZ',
        'delivery_deadline TIMESTAMPTZ',
        'status TEXT NOT NULL DEFAULT \'draft\'',
        'created_tx_hash TEXT UNIQUE',
        'approved_application_id BIGINT',
        'approved_artist_wallet TEXT',
        'approved_artist_profile_id BIGINT',
        'approved_artist_handle TEXT',
        'artist_wallet TEXT',
        'artist_profile_id BIGINT',
        'artist_handle TEXT',
        'claimed_tx_hash TEXT UNIQUE',
        'submitted_tx_hash TEXT UNIQUE',
        'approved_tx_hash TEXT UNIQUE',
        'cancelled_tx_hash TEXT UNIQUE',
        'payout_claim_tx_hash TEXT UNIQUE',
        'deliverable_uri TEXT',
        'submitted_at TIMESTAMPTZ',
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ]) {
        await db.unsafe(
          `ALTER TABLE "${CONFIG.SCHEMA}".commission_records ADD COLUMN IF NOT EXISTS ${definition}`,
        )
      }

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.commission_applications (
          id BIGSERIAL PRIMARY KEY,
          application_id BIGINT UNIQUE,
          application_ref TEXT UNIQUE,
          application_uri TEXT UNIQUE,
          commission_id BIGINT NOT NULL,
          artist_privy_user_id TEXT NOT NULL,
          artist_wallet TEXT NOT NULL,
          artist_profile_id BIGINT,
          artist_handle TEXT,
          message TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `

      for (const definition of [
        'application_id BIGINT UNIQUE',
        'application_ref TEXT UNIQUE',
        'application_uri TEXT UNIQUE',
        'artist_profile_id BIGINT',
        'artist_handle TEXT',
        'message TEXT',
        'status TEXT NOT NULL DEFAULT \'pending\'',
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ]) {
        await db.unsafe(
          `ALTER TABLE "${CONFIG.SCHEMA}".commission_applications ADD COLUMN IF NOT EXISTS ${definition}`,
        )
      }

      for (const statement of [
        `CREATE INDEX IF NOT EXISTS idx_commission_records_status_created
         ON "${CONFIG.SCHEMA}".commission_records (status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_commission_records_requester
         ON "${CONFIG.SCHEMA}".commission_records (requester_privy_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_commission_records_bungalow
         ON "${CONFIG.SCHEMA}".commission_records (bungalow_chain, bungalow_token_address)`,
        `CREATE INDEX IF NOT EXISTS idx_commission_applications_commission
         ON "${CONFIG.SCHEMA}".commission_applications (commission_id, created_at ASC)`,
        `CREATE INDEX IF NOT EXISTS idx_commission_applications_onchain
         ON "${CONFIG.SCHEMA}".commission_applications (application_id)`,
        `CREATE INDEX IF NOT EXISTS idx_commission_applications_artist
         ON "${CONFIG.SCHEMA}".commission_applications (artist_profile_id, created_at DESC)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_applications_unique_profile
         ON "${CONFIG.SCHEMA}".commission_applications (commission_id, artist_profile_id)
         WHERE artist_profile_id IS NOT NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_applications_unique_wallet
         ON "${CONFIG.SCHEMA}".commission_applications (commission_id, LOWER(artist_wallet))`,
      ]) {
        await db.unsafe(statement)
      }
    })()
  }

  await commissionsShapePromise
}

async function resolveAuthorizedEvmWallets(
  c: { get: (key: string) => unknown },
  privyUserId: string,
): Promise<`0x${string}`[]> {
  const claimWallets = Array.isArray(c.get('walletAddresses'))
    ? (c.get('walletAddresses') as string[])
    : []
  const storedWallets = (await getUserWallets(privyUserId)).map((row) => row.address)

  return [...new Set(
    [...claimWallets, ...storedWallets]
      .map((wallet) => normalizeAddress(wallet))
      .filter((wallet): wallet is `0x${string}` => Boolean(wallet)),
  )]
}

function assertAuthorizedEvmWallet(
  wallet: string | null,
  authorizedWallets: `0x${string}`[],
): `0x${string}` {
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'A valid EVM wallet is required')
  }

  const normalized = normalizeAddress(wallet)
  if (!normalized) {
    throw new ApiError(400, 'invalid_wallet', 'A valid EVM wallet is required')
  }

  if (!authorizedWallets.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  return normalized as `0x${string}`
}

async function getViewerContext(c: {
  get: (key: string) => unknown
}): Promise<ViewerContext> {
  const privyUserId = typeof c.get('privyUserId') === 'string'
    ? (c.get('privyUserId') as string)
    : null
  const wallets = Array.isArray(c.get('walletAddresses'))
    ? (c.get('walletAddresses') as string[])
    : typeof c.get('walletAddress') === 'string'
      ? [c.get('walletAddress') as string]
      : []

  const normalizedWallets = [...new Set(
    wallets
      .map((wallet) => normalizeAddress(wallet))
      .filter((wallet): wallet is `0x${string}` => Boolean(wallet)),
  )]
  const profileMatch = normalizedWallets.length > 0
    ? await findMemeticsProfileByWallets(normalizedWallets)
    : null

  return {
    privyUserId,
    wallets: normalizedWallets,
    profileId: profileMatch?.profile.id ?? null,
  }
}

function buildCommissionListWhere(input: {
  scope: string
  viewer: ViewerContext
}): { clause: string; params: Array<string | number> } {
  const params: Array<string | number> = []
  let clause = `cr.status <> 'draft'`

  if (input.scope === 'open') {
    clause = `cr.status = 'open'`
  } else if (input.scope === 'mine') {
    if (!input.viewer.privyUserId) {
      throw new ApiError(401, 'auth_required', 'Privy authentication required for this scope')
    }
    params.push(input.viewer.privyUserId)
    clause = `cr.requester_privy_user_id = $${params.length} AND cr.status <> 'draft'`
  } else if (input.scope === 'applied') {
    if (!input.viewer.profileId) {
      throw new ApiError(403, 'profile_required', 'Create your onchain profile before tracking applications')
    }
    params.push(input.viewer.profileId)
    clause = `cr.commission_id IN (
      SELECT ca.commission_id
      FROM "${CONFIG.SCHEMA}".commission_applications ca
      WHERE ca.artist_profile_id = $${params.length}
    )`
  } else if (input.scope === 'assigned') {
    if (!input.viewer.profileId) {
      throw new ApiError(403, 'profile_required', 'Create your onchain profile before tracking assignments')
    }
    params.push(input.viewer.profileId)
    params.push(input.viewer.profileId)
    clause = `(cr.approved_artist_profile_id = $${params.length - 1} OR cr.artist_profile_id = $${params.length})
      AND cr.status IN ('selected', 'claimed', 'submitted', 'disputed')`
  } else if (input.scope !== 'all') {
    throw new ApiError(400, 'invalid_scope', 'Unsupported commission scope')
  }

  return { clause, params }
}

async function getCommissionRecordByCommissionId(
  commissionId: number,
): Promise<CommissionRecordRow | null> {
  const rows = await db<CommissionRecordRow[]>`
    SELECT
      brief_id,
      commission_id,
      requester_privy_user_id,
      requester_wallet,
      requester_profile_id,
      requester_handle,
      bungalow_chain,
      bungalow_token_address,
      bungalow_name,
      rate_label,
      prompt,
      brief_uri,
      budget_jbm::text AS budget_jbm,
      claim_deadline::text AS claim_deadline,
      delivery_deadline::text AS delivery_deadline,
      status,
      created_tx_hash,
      approved_application_id,
      approved_artist_wallet,
      approved_artist_profile_id,
      approved_artist_handle,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      claimed_tx_hash,
      submitted_tx_hash,
      approved_tx_hash,
      cancelled_tx_hash,
      payout_claim_tx_hash,
      deliverable_uri,
      submitted_at::text AS submitted_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_records
    WHERE commission_id = ${commissionId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function getCommissionRecordByBriefId(briefId: string): Promise<CommissionRecordRow | null> {
  const rows = await db<CommissionRecordRow[]>`
    SELECT
      brief_id,
      commission_id,
      requester_privy_user_id,
      requester_wallet,
      requester_profile_id,
      requester_handle,
      bungalow_chain,
      bungalow_token_address,
      bungalow_name,
      rate_label,
      prompt,
      brief_uri,
      budget_jbm::text AS budget_jbm,
      claim_deadline::text AS claim_deadline,
      delivery_deadline::text AS delivery_deadline,
      status,
      created_tx_hash,
      approved_application_id,
      approved_artist_wallet,
      approved_artist_profile_id,
      approved_artist_handle,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      claimed_tx_hash,
      submitted_tx_hash,
      approved_tx_hash,
      cancelled_tx_hash,
      payout_claim_tx_hash,
      deliverable_uri,
      submitted_at::text AS submitted_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_records
    WHERE brief_id = ${briefId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function getCommissionListCount(whereClause: string, params: Array<string | number>): Promise<number> {
  const rows = await db.unsafe<Array<{ cnt: string }>>(
    `SELECT COUNT(*)::text AS cnt
     FROM "${CONFIG.SCHEMA}".commission_records cr
     WHERE ${whereClause}`,
    params,
  )

  return Number(rows[0]?.cnt ?? 0)
}

async function getCommissionList(
  whereClause: string,
  params: Array<string | number>,
  limit: number,
  offset: number,
): Promise<CommissionRecordRow[]> {
  return db.unsafe<CommissionRecordRow[]>(
    `SELECT
      cr.brief_id,
      cr.commission_id,
      cr.requester_privy_user_id,
      cr.requester_wallet,
      cr.requester_profile_id,
      cr.requester_handle,
      cr.bungalow_chain,
      cr.bungalow_token_address,
      cr.bungalow_name,
      cr.rate_label,
      cr.prompt,
      cr.brief_uri,
      cr.budget_jbm::text AS budget_jbm,
      cr.claim_deadline::text AS claim_deadline,
      cr.delivery_deadline::text AS delivery_deadline,
      cr.status,
      cr.created_tx_hash,
      cr.approved_application_id,
      cr.approved_artist_wallet,
      cr.approved_artist_profile_id,
      cr.approved_artist_handle,
      cr.artist_wallet,
      cr.artist_profile_id,
      cr.artist_handle,
      cr.claimed_tx_hash,
      cr.submitted_tx_hash,
      cr.approved_tx_hash,
      cr.cancelled_tx_hash,
      cr.payout_claim_tx_hash,
      cr.deliverable_uri,
      cr.submitted_at::text AS submitted_at,
      cr.created_at::text AS created_at,
      cr.updated_at::text AS updated_at
    FROM "${CONFIG.SCHEMA}".commission_records cr
    WHERE ${whereClause}
    ORDER BY cr.updated_at DESC, cr.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
}

async function getApplicationCounts(
  commissionIds: number[],
): Promise<Map<number, ApplicationCountRow>> {
  if (commissionIds.length === 0) return new Map()

  const rows = await db<Array<ApplicationCountRow & { applications_count: string; pending_applications: string }>>`
    SELECT
      commission_id,
      COUNT(*)::text AS applications_count,
      COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_applications
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id IN ${db(commissionIds)}
    GROUP BY commission_id
  `

  return new Map(
    rows.map((row) => [
      row.commission_id,
      {
        commission_id: row.commission_id,
        applications_count: Number(row.applications_count ?? 0),
        pending_applications: Number(row.pending_applications ?? 0),
      },
    ]),
  )
}

async function getViewerApplicationMap(
  commissionIds: number[],
  viewerProfileId: number | null,
): Promise<Map<number, ViewerApplicationRow>> {
  if (!viewerProfileId || commissionIds.length === 0) {
    return new Map()
  }

  const rows = await db<ViewerApplicationRow[]>`
    SELECT
      commission_id,
      COALESCE(application_id, id) AS application_id,
      status
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id IN ${db(commissionIds)}
      AND artist_profile_id = ${viewerProfileId}
      AND status <> 'draft'
  `

  return new Map(rows.map((row) => [row.commission_id, row]))
}

async function getCommissionApplications(
  commissionId: number,
  viewer: ViewerContext,
  requesterPrivyUserId: string,
): Promise<CommissionApplicationRow[]> {
  if (viewer.privyUserId && viewer.privyUserId === requesterPrivyUserId) {
    return db<CommissionApplicationRow[]>`
      SELECT
        id,
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM ${db(CONFIG.SCHEMA)}.commission_applications
      WHERE commission_id = ${commissionId}
        AND status <> 'draft'
      ORDER BY
        CASE status
          WHEN 'selected' THEN 0
          WHEN 'accepted' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'rejected' THEN 3
          WHEN 'expired' THEN 4
          ELSE 5
        END,
        created_at ASC
    `
  }

  if (viewer.profileId) {
    return db<CommissionApplicationRow[]>`
      SELECT
        id,
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM ${db(CONFIG.SCHEMA)}.commission_applications
      WHERE commission_id = ${commissionId}
        AND (
          artist_profile_id = ${viewer.profileId}
          OR status = 'selected'
          OR status = 'accepted'
        )
        AND status <> 'draft'
      ORDER BY created_at ASC
    `
  }

  return db<CommissionApplicationRow[]>`
    SELECT
      id,
      application_id,
      application_ref,
      application_uri,
      commission_id,
      artist_privy_user_id,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      message,
      status,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id = ${commissionId}
      AND (status = 'selected' OR status = 'accepted')
    ORDER BY created_at ASC
  `
}

function extractApplicationRefFromUri(uri: string | null | undefined): string | null {
  const value = asString(uri)
  if (!value) return null
  const match = value.match(/\/api\/commissions\/applications\/([a-f0-9]+)$/i)
  return match?.[1] ?? null
}

function decodeCommissionManagerReceiptLogs(receipt: Awaited<ReturnType<typeof publicClients.base.getTransactionReceipt>>) {
  return receipt.logs
    .map((log) =>
      decodeCommissionManagerLog({
        address: log.address,
        data: log.data,
        topics: log.topics as `0x${string}`[],
      }),
    )
    .filter((log): log is NonNullable<ReturnType<typeof decodeCommissionManagerLog>> => Boolean(log))
}

async function resolveCommissionContractBungalowId(row: CommissionRecordRow): Promise<number | null> {
  const chain = toSupportedChain(row.bungalow_chain)
  if (!chain) return null

  const projectContext = await getCanonicalProjectContext(chain, row.bungalow_token_address)
  const primaryDeployment = projectContext.primaryDeployment
  const tokenRegistry = await getTokenRegistry(primaryDeployment.token_address, primaryDeployment.chain)
  const primaryAssetKey = computeMemeticsPrimaryAssetKey(
    toMemeticsAssetChain(primaryDeployment.chain as SupportedChain),
    inferMemeticsAssetKind({
      chain: primaryDeployment.chain as SupportedChain,
      decimals: tokenRegistry?.decimals ?? null,
    }),
    primaryDeployment.token_address,
  )

  return readMemeticsBungalowIdByAssetKey(primaryAssetKey)
}

async function syncCommissionApplicationsWithChain(commissionId: number): Promise<void> {
  if (!commissionId) return

  const [chainApplications, existingRows] = await Promise.all([
    readCommissionManagerApplications(commissionId),
    db<CommissionApplicationRow[]>`
      SELECT
        id,
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM ${db(CONFIG.SCHEMA)}.commission_applications
      WHERE commission_id = ${commissionId}
    `,
  ])

  if (chainApplications.length === 0) {
    return
  }

  const byApplicationId = new Map(
    existingRows
      .filter((row) => typeof row.application_id === 'number' && row.application_id > 0)
      .map((row) => [row.application_id as number, row]),
  )
  const byUri = new Map(
    existingRows
      .filter((row) => row.application_uri)
      .map((row) => [row.application_uri as string, row]),
  )

  for (const chainApplication of chainApplications) {
    const nextStatus = normalizeApplicationStatus(chainApplication.status)
    const artistProfileId = chainApplication.artistProfileId > 0
      ? chainApplication.artistProfileId
      : null
    const artistProfile = artistProfileId
      ? await readMemeticsProfile(artistProfileId)
      : null
    const artistHandle = artistProfile?.handle ?? null
    const artistWallet = artistProfile?.mainWallet ?? ''
    const applicationRef = extractApplicationRefFromUri(chainApplication.applicationURI)
    const existing = byApplicationId.get(chainApplication.id) ?? byUri.get(chainApplication.applicationURI)

    if (!existing) {
      await db`
        INSERT INTO ${db(CONFIG.SCHEMA)}.commission_applications (
          application_id,
          application_ref,
          application_uri,
          commission_id,
          artist_privy_user_id,
          artist_wallet,
          artist_profile_id,
          artist_handle,
          message,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${chainApplication.id},
          ${applicationRef},
          ${chainApplication.applicationURI},
          ${commissionId},
          '',
          ${artistWallet},
          ${artistProfileId},
          ${artistHandle},
          NULL,
          ${nextStatus},
          ${new Date(chainApplication.createdAt * 1000).toISOString()},
          NOW()
        )
      `
      continue
    }

    const hasChanges =
      existing.application_id !== chainApplication.id ||
      existing.application_ref !== applicationRef ||
      existing.application_uri !== chainApplication.applicationURI ||
      existing.artist_profile_id !== artistProfileId ||
      existing.artist_handle !== artistHandle ||
      existing.artist_wallet !== artistWallet ||
      existing.status !== nextStatus

    if (!hasChanges) {
      continue
    }

    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.commission_applications
      SET
        application_id = ${chainApplication.id},
        application_ref = ${applicationRef},
        application_uri = ${chainApplication.applicationURI},
        artist_profile_id = ${artistProfileId},
        artist_handle = ${artistHandle},
        artist_wallet = ${artistWallet},
        status = ${nextStatus},
        updated_at = NOW()
      WHERE id = ${existing.id}
    `
  }
}

async function syncCommissionRecordWithChain(
  row: CommissionRecordRow,
): Promise<CommissionRecordRow> {
  if (!row.commission_id) {
    return row
  }

  const chainCommission = await readCommissionManagerCommission(row.commission_id)
  if (!chainCommission || chainCommission.id === 0) {
    return row
  }

  const nextStatus = normalizeCommissionStatus(chainCommission.status)
  const nextClaimDeadline =
    chainCommission.acceptanceDeadline > 0
      ? new Date(chainCommission.acceptanceDeadline * 1000).toISOString()
      : row.claim_deadline
  const nextDeliveryDeadline = new Date(chainCommission.deliveryDeadline * 1000).toISOString()
  const nextSubmittedAt = chainCommission.submittedAt > 0
    ? new Date(chainCommission.submittedAt * 1000).toISOString()
    : null
  const nextDeliverableUri = chainCommission.deliverableURI || null
  const nextRequesterProfileId = chainCommission.requesterProfileId > 0
    ? chainCommission.requesterProfileId
    : null
  const nextApprovedApplicationId = chainCommission.selectedApplicationId > 0
    ? chainCommission.selectedApplicationId
    : null
  const nextApprovedArtistProfileId =
    nextApprovedApplicationId && chainCommission.artistProfileId > 0
      ? chainCommission.artistProfileId
      : null
  const nextArtistProfileId =
    chainCommission.status >= 2 && chainCommission.artistProfileId > 0
      ? chainCommission.artistProfileId
      : null

  let requesterHandle = row.requester_handle
  if (nextRequesterProfileId && nextRequesterProfileId !== row.requester_profile_id) {
    const requesterProfile = await readMemeticsProfile(nextRequesterProfileId)
    requesterHandle = requesterProfile?.handle ?? requesterHandle
  }

  let approvedArtistHandle = row.approved_artist_handle
  let approvedArtistWallet = row.approved_artist_wallet
  if (nextApprovedArtistProfileId) {
    const approvedArtistProfile = await readMemeticsProfile(nextApprovedArtistProfileId)
    approvedArtistHandle = approvedArtistProfile?.handle ?? approvedArtistHandle
    approvedArtistWallet = approvedArtistProfile?.mainWallet ?? approvedArtistWallet
  } else {
    approvedArtistHandle = null
    approvedArtistWallet = null
  }

  let artistHandle = row.artist_handle
  let artistWallet = row.artist_wallet
  if (nextArtistProfileId) {
    const artistProfile = await readMemeticsProfile(nextArtistProfileId)
    artistHandle = artistProfile?.handle ?? artistHandle
    artistWallet = artistProfile?.mainWallet ?? artistWallet
  } else {
    artistHandle = null
    artistWallet = null
  }

  const hasChanges =
    nextStatus !== row.status ||
    nextClaimDeadline !== row.claim_deadline ||
    nextDeliveryDeadline !== row.delivery_deadline ||
    nextSubmittedAt !== row.submitted_at ||
    nextDeliverableUri !== row.deliverable_uri ||
    nextRequesterProfileId !== row.requester_profile_id ||
    requesterHandle !== row.requester_handle ||
    nextApprovedApplicationId !== row.approved_application_id ||
    nextApprovedArtistProfileId !== row.approved_artist_profile_id ||
    approvedArtistHandle !== row.approved_artist_handle ||
    approvedArtistWallet !== row.approved_artist_wallet ||
    nextArtistProfileId !== row.artist_profile_id ||
    artistHandle !== row.artist_handle ||
    artistWallet !== row.artist_wallet

  if (!hasChanges) {
    return row
  }

  const rows = await db<CommissionRecordRow[]>`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      requester_profile_id = ${nextRequesterProfileId},
      requester_handle = ${requesterHandle},
      approved_application_id = ${nextApprovedApplicationId},
      approved_artist_profile_id = ${nextApprovedArtistProfileId},
      approved_artist_handle = ${approvedArtistHandle},
      approved_artist_wallet = ${approvedArtistWallet},
      artist_profile_id = ${nextArtistProfileId},
      artist_handle = ${artistHandle},
      artist_wallet = ${artistWallet},
      claim_deadline = ${nextClaimDeadline},
      delivery_deadline = ${nextDeliveryDeadline},
      submitted_at = ${nextSubmittedAt},
      deliverable_uri = ${nextDeliverableUri},
      status = ${nextStatus},
      updated_at = NOW()
    WHERE brief_id = ${row.brief_id}
    RETURNING
      brief_id,
      commission_id,
      requester_privy_user_id,
      requester_wallet,
      requester_profile_id,
      requester_handle,
      bungalow_chain,
      bungalow_token_address,
      bungalow_name,
      rate_label,
      prompt,
      brief_uri,
      budget_jbm::text AS budget_jbm,
      claim_deadline::text AS claim_deadline,
      delivery_deadline::text AS delivery_deadline,
      status,
      created_tx_hash,
      approved_application_id,
      approved_artist_wallet,
      approved_artist_profile_id,
      approved_artist_handle,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      claimed_tx_hash,
      submitted_tx_hash,
      approved_tx_hash,
      cancelled_tx_hash,
      payout_claim_tx_hash,
      deliverable_uri,
      submitted_at::text AS submitted_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
  `

  return rows[0] ?? row
}

async function buildCommissionDetailPayload(
  row: CommissionRecordRow,
  viewer: ViewerContext,
) {
  const syncedRow = await syncCommissionRecordWithChain(row)
  if (syncedRow.commission_id) {
    await syncCommissionApplicationsWithChain(syncedRow.commission_id)
  }
  const isRequester = Boolean(
    viewer.privyUserId && viewer.privyUserId === syncedRow.requester_privy_user_id,
  )
  const applications = syncedRow.commission_id
    ? await getCommissionApplications(
        syncedRow.commission_id,
        viewer,
        syncedRow.requester_privy_user_id,
      )
    : []

  const viewerApplication = viewer.profileId
    ? applications.find((entry) => entry.artist_profile_id === viewer.profileId) ?? null
    : null
  const submittedAtUnix = syncedRow.submitted_at
    ? Math.floor(new Date(syncedRow.submitted_at).getTime() / 1000)
    : 0
  const acceptanceDeadlineUnix = syncedRow.claim_deadline
    ? Math.floor(new Date(syncedRow.claim_deadline).getTime() / 1000)
    : 0
  const deliveryDeadlineUnix = syncedRow.delivery_deadline
    ? Math.floor(new Date(syncedRow.delivery_deadline).getTime() / 1000)
    : 0
  const nowUnix = Math.floor(Date.now() / 1000)
  const viewerApplicationStatus = viewerApplication?.status ?? null
  const hasActiveViewerApplication =
    viewerApplicationStatus === 'pending' ||
    viewerApplicationStatus === 'selected' ||
    viewerApplicationStatus === 'accepted'
  const selectionExpired =
    syncedRow.status === 'selected' &&
    acceptanceDeadlineUnix > 0 &&
    nowUnix > acceptanceDeadlineUnix
  const deliveryExpired =
    syncedRow.status === 'claimed' &&
    deliveryDeadlineUnix > 0 &&
    nowUnix > deliveryDeadlineUnix
  const pendingApplications = applications.filter((entry) => entry.status === 'pending').length

  return {
    commission: normalizeCommissionRow(syncedRow, {
      applicationsCount: isRequester ? applications.length : 0,
      pendingApplications: isRequester ? pendingApplications : 0,
      viewerApplication: viewerApplication
        ? { id: viewerApplication.id, status: viewerApplication.status }
        : null,
    }),
    applications: applications.map((entry) => normalizeApplicationRow(entry)),
    viewer: {
      authenticated: Boolean(viewer.privyUserId),
      profile_id: viewer.profileId,
      wallets: viewer.wallets,
      is_requester: isRequester,
      is_approved_artist: Boolean(
        viewer.profileId && viewer.profileId === syncedRow.approved_artist_profile_id,
      ),
      is_artist: Boolean(viewer.profileId && viewer.profileId === syncedRow.artist_profile_id),
      can_apply: Boolean(
        viewer.profileId &&
          syncedRow.status === 'open' &&
          !isRequester &&
          !hasActiveViewerApplication,
      ),
      can_approve_artist: Boolean(
        isRequester &&
          pendingApplications > 0 &&
          (syncedRow.status === 'open' || selectionExpired),
      ),
      can_claim: Boolean(
        viewer.profileId &&
          syncedRow.status === 'selected' &&
          viewer.profileId === syncedRow.approved_artist_profile_id &&
          !selectionExpired,
      ),
      can_submit: Boolean(
        viewer.profileId &&
          syncedRow.status === 'claimed' &&
          viewer.profileId === syncedRow.artist_profile_id,
      ),
      can_approve_completion: Boolean(
        isRequester && syncedRow.status === 'submitted',
      ),
      can_cancel: Boolean(
        isRequester &&
          (
            syncedRow.status === 'open' ||
            selectionExpired ||
            deliveryExpired
          ),
      ),
      can_claim_timeout_payout: Boolean(
        viewer.profileId &&
          syncedRow.status === 'submitted' &&
          viewer.profileId === syncedRow.artist_profile_id &&
          submittedAtUnix > 0 &&
          nowUnix >= submittedAtUnix + REVIEW_WINDOW_SECONDS,
      ),
    },
  }
}

commissionsRoute.use('/commissions/*', optionalWalletContext)

commissionsRoute.get('/commissions', async (c) => {
  await ensureCommissionsShape()

  const viewer = await getViewerContext(c)
  const scope = asString(c.req.query('scope')) || 'open'
  const limit = Math.min(Math.max(asPositiveInt(c.req.query('limit')) || 24, 1), 60)
  const offset = Math.max(asPositiveInt(c.req.query('offset')), 0)
  const { clause, params } = buildCommissionListWhere({ scope, viewer })

  const [rows, total] = await Promise.all([
    getCommissionList(clause, params, limit, offset),
    getCommissionListCount(clause, params),
  ])

  const syncedRows = await Promise.all(rows.map((row) => syncCommissionRecordWithChain(row)))
  const commissionIds = syncedRows
    .map((row) => row.commission_id)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  await Promise.all(commissionIds.map((commissionId) => syncCommissionApplicationsWithChain(commissionId)))
  const [countMap, viewerApplicationMap] = await Promise.all([
    getApplicationCounts(commissionIds),
    getViewerApplicationMap(commissionIds, viewer.profileId),
  ])

  return c.json({
    items: syncedRows.map((row) => {
      const counts = row.commission_id ? countMap.get(row.commission_id) : undefined
      const viewerApplication = row.commission_id
        ? viewerApplicationMap.get(row.commission_id)
        : undefined
      return normalizeCommissionRow(row, {
        applicationsCount: counts?.applications_count ?? 0,
        pendingApplications: counts?.pending_applications ?? 0,
        viewerApplication: viewerApplication
          ? {
              id: viewerApplication.application_id,
              status: viewerApplication.status,
            }
          : null,
      })
    }),
    total,
    scope,
    viewer: {
      authenticated: Boolean(viewer.privyUserId),
      profile_id: viewer.profileId,
      wallets: viewer.wallets,
    },
  })
})

commissionsRoute.get('/commissions/briefs/:briefId', async (c) => {
  await ensureCommissionsShape()

  const briefId = asString(c.req.param('briefId'))
  if (!briefId) {
    throw new ApiError(400, 'invalid_brief', 'Invalid commission brief identifier')
  }

  const record = await getCommissionRecordByBriefId(briefId)
  if (!record) {
    throw new ApiError(404, 'commission_not_found', 'Commission brief not found')
  }

  return c.json({
    brief_id: record.brief_id,
    commission_id: record.commission_id,
    requester_profile_id: record.requester_profile_id,
    requester_handle: record.requester_handle,
    bungalow_chain: record.bungalow_chain,
    bungalow_token_address: record.bungalow_token_address,
    bungalow_name: record.bungalow_name,
    rate_label: record.rate_label,
    prompt: record.prompt,
    budget_jbm: record.budget_jbm,
    claim_deadline: record.claim_deadline,
    delivery_deadline: record.delivery_deadline,
    created_at: record.created_at,
  })
})

commissionsRoute.get('/commissions/:commissionId', async (c) => {
  await ensureCommissionsShape()

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const record = await getCommissionRecordByCommissionId(commissionId)
  if (!record) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }

  const viewer = await getViewerContext(c)
  return c.json(await buildCommissionDetailPayload(record, viewer))
})

commissionsRoute.post('/commissions/drafts', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const selectedWallet = assertAuthorizedEvmWallet(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const profileId = await readWalletProfileId(selectedWallet)
  if (!profileId) {
    throw new ApiError(403, 'profile_required', 'Create your onchain profile before opening commissions')
  }

  const profile = await readMemeticsProfile(profileId)
  const requestedChain = toSupportedChain(asString(body.bungalow_chain))
  if (!requestedChain) {
    throw new ApiError(400, 'invalid_chain', 'Choose a valid bungalow')
  }

  const requestedTokenAddress = normalizeAddress(asString(body.bungalow_token_address), requestedChain)
  if (!requestedTokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Choose a valid bungalow')
  }

  const rateLabel = asString(body.rate_label)
  if (!rateLabel || rateLabel.length > MAX_RATE_LABEL_LENGTH) {
    throw new ApiError(400, 'invalid_rate', 'Rate / format must be between 1 and 80 characters')
  }

  const prompt = asString(body.prompt)
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new ApiError(400, 'invalid_prompt', 'Prompt must be between 1 and 4000 characters')
  }

  const budgetJbm = normalizeBudgetInput(body.budget_jbm)
  const deliveryDeadline = parseDeliveryDeadline(body.delivery_deadline)
  const claimDeadlineUnix = deriveClaimDeadline(deliveryDeadline.unix)
  const claimDeadlineIso = new Date(claimDeadlineUnix * 1000).toISOString()

  const projectContext = await getCanonicalProjectContext(requestedChain, requestedTokenAddress)
  const primaryDeployment = projectContext.primaryDeployment
  const tokenRegistry = await getTokenRegistry(primaryDeployment.token_address, primaryDeployment.chain)
  const primaryAssetKey = computeMemeticsPrimaryAssetKey(
    toMemeticsAssetChain(primaryDeployment.chain as SupportedChain),
    inferMemeticsAssetKind({
      chain: primaryDeployment.chain as SupportedChain,
      decimals: tokenRegistry?.decimals ?? null,
    }),
    primaryDeployment.token_address,
  )
  const bungalowId = await readMemeticsBungalowIdByAssetKey(primaryAssetKey)
  if (!bungalowId) {
    throw new ApiError(404, 'bungalow_not_found', 'That bungalow is not open onchain yet')
  }

  const bungalowRow = await getBungalow(primaryDeployment.token_address, primaryDeployment.chain)
  const bungalowName =
    bungalowRow?.name ??
    tokenRegistry?.name ??
    tokenRegistry?.symbol ??
    primaryDeployment.token_address

  const briefId = createBriefId()
  const briefUri = `${getRequestSiteUrl(c.req.raw)}/api/commissions/briefs/${briefId}`

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.commission_records (
      brief_id,
      requester_privy_user_id,
      requester_wallet,
      requester_profile_id,
      requester_handle,
      bungalow_chain,
      bungalow_token_address,
      bungalow_name,
      rate_label,
      prompt,
      brief_uri,
      budget_jbm,
      claim_deadline,
      delivery_deadline,
      status
    )
    VALUES (
      ${briefId},
      ${privyUserId},
      ${selectedWallet},
      ${profileId},
      ${profile?.handle ?? null},
      ${primaryDeployment.chain},
      ${primaryDeployment.token_address},
      ${bungalowName},
      ${rateLabel},
      ${prompt},
      ${briefUri},
      ${budgetJbm},
      ${claimDeadlineIso},
      ${deliveryDeadline.iso},
      'draft'
    )
  `

  return c.json({
    brief_id: briefId,
    brief_uri: briefUri,
    requester_wallet: selectedWallet,
    requester_profile_id: profileId,
    requester_handle: profile?.handle ?? null,
    bungalow: {
      chain: primaryDeployment.chain,
      token_address: primaryDeployment.token_address,
      name: bungalowName,
      contract_bungalow_id: bungalowId,
    },
    rate_label: rateLabel,
    prompt,
    budget_jbm: budgetJbm,
    budget_wei: parseUnits(budgetJbm, 18).toString(),
    claim_deadline: claimDeadlineUnix,
    delivery_deadline: deliveryDeadline.unix,
    contract_address: CONFIG.COMMISSION_MANAGER_CONTRACT_ADDRESS,
    commission_manager_address: getCommissionManagerContractAddress(),
  })
})

commissionsRoute.post('/commissions/confirm-create', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const briefId = asString(body.brief_id)
  if (!briefId) {
    throw new ApiError(400, 'invalid_brief', 'brief_id is required')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const record = await getCommissionRecordByBriefId(briefId)
  if (!record || record.requester_privy_user_id !== privyUserId) {
    throw new ApiError(404, 'commission_not_found', 'Commission draft not found')
  }

  if (record.created_tx_hash && record.created_tx_hash.toLowerCase() === txHash && record.commission_id) {
    return c.json(await buildCommissionDetailPayload(record, {
      privyUserId,
      wallets: await resolveAuthorizedEvmWallets(c, privyUserId),
      profileId: record.requester_profile_id,
    }))
  }

  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }

  if (receipt.from.toLowerCase() !== record.requester_wallet.toLowerCase()) {
    throw new ApiError(401, 'wallet_not_owned', 'The transaction wallet does not match this draft')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const createdEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionCreated' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) > 0,
  )
  if (!createdEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionCreated')
  }

  const commissionId = Number((createdEvent.args as Record<string, unknown>).commissionId ?? 0)
  const requesterProfileId = Number((createdEvent.args as Record<string, unknown>).requesterProfileId ?? 0)
  const bungalowId = Number((createdEvent.args as Record<string, unknown>).bungalowId ?? 0)
  const budget = (createdEvent.args as Record<string, unknown>).budget
  const deliveryDeadline = Number((createdEvent.args as Record<string, unknown>).deliveryDeadline ?? 0)
  const briefUri = String((createdEvent.args as Record<string, unknown>).briefURI ?? '')

  if (!commissionId || !requesterProfileId || !bungalowId || !briefUri) {
    throw new ApiError(409, 'unexpected_receipt', 'CommissionCreated payload was incomplete')
  }

  if (briefUri !== record.brief_uri) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain brief URI did not match this draft')
  }

  if (String(budget) !== parseUnits(record.budget_jbm, 18).toString()) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain budget did not match this draft')
  }

  const expectedDeliveryDeadline = Math.floor(new Date(record.delivery_deadline).getTime() / 1000)
  if (deliveryDeadline !== expectedDeliveryDeadline) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain delivery deadline did not match this draft')
  }

  const expectedBungalowId = await resolveCommissionContractBungalowId(record)
  if (!expectedBungalowId || bungalowId !== expectedBungalowId) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain bungalow did not match this draft')
  }

  const requesterProfile = await readMemeticsProfile(requesterProfileId)
  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      commission_id = ${commissionId},
      requester_profile_id = ${requesterProfileId},
      requester_handle = ${requesterProfile?.handle ?? record.requester_handle},
      created_tx_hash = ${txHash},
      status = 'open',
      updated_at = NOW()
    WHERE brief_id = ${briefId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_confirm_failed', 'Commission was created but could not be indexed')
  }

  return c.json(await buildCommissionDetailPayload(updated, {
    privyUserId,
    wallets: await resolveAuthorizedEvmWallets(c, privyUserId),
    profileId: requesterProfileId,
  }))
})

commissionsRoute.post('/commissions/:commissionId/apply', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  await syncCommissionApplicationsWithChain(commissionId)
  if (record.status !== 'open') {
    throw new ApiError(409, 'invalid_state', 'Only open commissions accept new applications')
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const selectedWallet = assertAuthorizedEvmWallet(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const artistProfileId = await readWalletProfileId(selectedWallet)
  if (!artistProfileId) {
    throw new ApiError(403, 'profile_required', 'Create your onchain profile before applying')
  }
  if (record.requester_profile_id && artistProfileId === record.requester_profile_id) {
    throw new ApiError(403, 'invalid_artist', 'You cannot apply to your own commission')
  }

  const artistProfile = await readMemeticsProfile(artistProfileId)
  const message = asOptionalString(body.message, MAX_APPLICATION_MESSAGE_LENGTH)
  const applicationRef = createApplicationRef()
  const applicationUri = `${getRequestSiteUrl(c.req.raw)}/api/commissions/applications/${applicationRef}`

  const existingRows = await db<CommissionApplicationRow[]>`
    SELECT
      id,
      application_id,
      application_ref,
      application_uri,
      commission_id,
      artist_privy_user_id,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      message,
      status,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id = ${commissionId}
      AND artist_profile_id = ${artistProfileId}
    LIMIT 1
  `
  const existing = existingRows[0] ?? null

  if (existing && ['pending', 'selected', 'accepted'].includes(existing.status)) {
    throw new ApiError(409, 'duplicate_application', 'You already have an active application for this commission')
  }

  let application: CommissionApplicationRow
  if (existing) {
    const rows = await db<CommissionApplicationRow[]>`
      UPDATE ${db(CONFIG.SCHEMA)}.commission_applications
      SET
        application_id = NULL,
        application_ref = ${applicationRef},
        application_uri = ${applicationUri},
        artist_privy_user_id = ${privyUserId},
        artist_wallet = ${selectedWallet},
        artist_profile_id = ${artistProfileId},
        artist_handle = ${artistProfile?.handle ?? existing.artist_handle},
        message = ${message},
        status = 'draft',
        created_at = NOW(),
        updated_at = NOW()
      WHERE id = ${existing.id}
      RETURNING
        id,
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status,
        created_at::text AS created_at,
        updated_at::text AS updated_at
    `
    application = rows[0]
  } else {
    const rows = await db<CommissionApplicationRow[]>`
      INSERT INTO ${db(CONFIG.SCHEMA)}.commission_applications (
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status
      )
      VALUES (
        ${applicationRef},
        ${applicationUri},
        ${commissionId},
        ${privyUserId},
        ${selectedWallet},
        ${artistProfileId},
        ${artistProfile?.handle ?? null},
        ${message},
        'draft'
      )
      RETURNING
        id,
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status,
        created_at::text AS created_at,
        updated_at::text AS updated_at
    `
    application = rows[0]
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  return c.json({
    application: normalizeApplicationRow(application),
    contract_address: getCommissionManagerContractAddress(),
    commission_manager_address: getCommissionManagerContractAddress(),
  })
})

commissionsRoute.get('/commissions/applications/:applicationRef', async (c) => {
  await ensureCommissionsShape()

  const applicationRef = asString(c.req.param('applicationRef'))
  if (!applicationRef) {
    throw new ApiError(400, 'invalid_application', 'Invalid commission application reference')
  }

  const rows = await db<CommissionApplicationRow[]>`
    SELECT
      id,
      application_id,
      application_ref,
      application_uri,
      commission_id,
      artist_privy_user_id,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      message,
      status,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE application_ref = ${applicationRef}
    LIMIT 1
  `
  const application = rows[0] ?? null
  if (!application) {
    throw new ApiError(404, 'application_not_found', 'Commission application not found')
  }

  return c.json({
    application_ref: application.application_ref,
    application_uri: application.application_uri,
    commission_id: application.commission_id,
    artist_profile_id: application.artist_profile_id,
    artist_handle: application.artist_handle,
    artist_wallet: application.artist_wallet,
    message: application.message,
    status: application.status,
    created_at: application.created_at,
    updated_at: application.updated_at,
  })
})

commissionsRoute.post('/commissions/:commissionId/apply/confirm', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  await syncCommissionRecordWithChain(existingRecord)

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const viewerProfileId = (await findMemeticsProfileByWallets(authorizedWallets))?.profile.id ?? null
  if (!viewerProfileId) {
    throw new ApiError(403, 'profile_required', 'Create your onchain profile before applying')
  }

  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)
  const appliedEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionApplicationCreated' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  if (!appliedEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionApplicationCreated')
  }

  const applicationId = Number((appliedEvent.args as Record<string, unknown>).applicationId ?? 0)
  const artistProfileId = Number((appliedEvent.args as Record<string, unknown>).artistProfileId ?? 0)
  const applicationUri = String((appliedEvent.args as Record<string, unknown>).applicationURI ?? '')
  if (!applicationId || !artistProfileId || !applicationUri) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain application payload was incomplete')
  }
  if (artistProfileId !== viewerProfileId) {
    throw new ApiError(403, 'not_artist', 'Only the applying artist can confirm this application')
  }

  await syncCommissionApplicationsWithChain(commissionId)
  const alreadyConfirmedRows = await db<CommissionApplicationRow[]>`
    SELECT
      id,
      application_id,
      application_ref,
      application_uri,
      commission_id,
      artist_privy_user_id,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      message,
      status,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id = ${commissionId}
      AND application_id = ${applicationId}
    LIMIT 1
  `
  if (alreadyConfirmedRows[0]) {
    const updated = await getCommissionRecordByCommissionId(commissionId)
    if (!updated) {
      throw new ApiError(500, 'commission_update_failed', 'Commission application could not be indexed')
    }
    return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
  }

  const artistProfile = await readMemeticsProfile(artistProfileId)
  const draftRows = await db<CommissionApplicationRow[]>`
    SELECT
      id,
      application_id,
      application_ref,
      application_uri,
      commission_id,
      artist_privy_user_id,
      artist_wallet,
      artist_profile_id,
      artist_handle,
      message,
      status,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM ${db(CONFIG.SCHEMA)}.commission_applications
    WHERE commission_id = ${commissionId}
      AND artist_profile_id = ${artistProfileId}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `
  const draft = draftRows[0] ?? null
  const applicationRef = extractApplicationRefFromUri(applicationUri)

  if (draft) {
    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.commission_applications
      SET
        application_id = ${applicationId},
        application_ref = ${applicationRef},
        application_uri = ${applicationUri},
        artist_privy_user_id = ${privyUserId},
        artist_wallet = ${receipt.from},
        artist_profile_id = ${artistProfileId},
        artist_handle = ${artistProfile?.handle ?? draft.artist_handle},
        status = 'pending',
        updated_at = NOW()
      WHERE id = ${draft.id}
    `
  } else {
    await db`
      INSERT INTO ${db(CONFIG.SCHEMA)}.commission_applications (
        application_id,
        application_ref,
        application_uri,
        commission_id,
        artist_privy_user_id,
        artist_wallet,
        artist_profile_id,
        artist_handle,
        message,
        status
      )
      VALUES (
        ${applicationId},
        ${applicationRef},
        ${applicationUri},
        ${commissionId},
        ${privyUserId},
        ${receipt.from},
        ${artistProfileId},
        ${artistProfile?.handle ?? null},
        NULL,
        'pending'
      )
    `
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission application could not be indexed')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
})

commissionsRoute.post(
  '/commissions/:commissionId/applications/:applicationId/approve/confirm',
  requirePrivyAuth,
  async (c) => {
    await ensureCommissionsShape()

    const privyUserId = c.get('privyUserId')
    if (!privyUserId) {
      throw new ApiError(401, 'auth_required', 'Privy authentication required')
    }

    const commissionId = asPositiveInt(c.req.param('commissionId'))
    const applicationId = asPositiveInt(c.req.param('applicationId'))
    if (!commissionId || !applicationId) {
      throw new ApiError(400, 'invalid_commission', 'Invalid commission or application id')
    }

    const body = asObject(await c.req.json().catch(() => null))
    if (!body) {
      throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
    }

    const txHash = asString(body.tx_hash).toLowerCase()
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
    }

    const existingRecord = await getCommissionRecordByCommissionId(commissionId)
    if (!existingRecord || existingRecord.requester_privy_user_id !== privyUserId) {
      throw new ApiError(404, 'commission_not_found', 'Commission not found')
    }
    const record = await syncCommissionRecordWithChain(existingRecord)

    if (record.status === 'selected' && record.approved_application_id === applicationId) {
      return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
    }

    const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
    const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
    if (receipt.status !== 'success') {
      throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
    }
    if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
      throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
    }

    const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)
    const selectedEvent = decodedLogs.find(
      (log) =>
        log.eventName === 'CommissionArtistSelected' &&
        Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
    )
    if (!selectedEvent) {
      throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionArtistSelected')
    }

    const selectedApplicationId = Number((selectedEvent.args as Record<string, unknown>).applicationId ?? 0)
    const artistProfileId = Number((selectedEvent.args as Record<string, unknown>).artistProfileId ?? 0)
    const acceptanceDeadline = Number((selectedEvent.args as Record<string, unknown>).acceptanceDeadline ?? 0)
    if (
      !selectedApplicationId ||
      selectedApplicationId !== applicationId ||
      !artistProfileId ||
      !acceptanceDeadline
    ) {
      throw new ApiError(409, 'unexpected_receipt', 'The onchain selection payload was incomplete')
    }

    const artistProfile = await readMemeticsProfile(artistProfileId)
    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.commission_records
      SET
        approved_application_id = ${selectedApplicationId},
        approved_artist_wallet = ${artistProfile?.mainWallet ?? null},
        approved_artist_profile_id = ${artistProfileId},
        approved_artist_handle = ${artistProfile?.handle ?? null},
        claim_deadline = ${new Date(acceptanceDeadline * 1000).toISOString()},
        status = 'selected',
        updated_at = NOW()
      WHERE commission_id = ${commissionId}
    `

    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.commission_applications
      SET
        status = CASE
          WHEN application_id = ${selectedApplicationId} THEN 'selected'
          ELSE status
        END,
        updated_at = NOW()
      WHERE commission_id = ${commissionId}
    `

    const updated = await getCommissionRecordByCommissionId(commissionId)
    if (!updated) {
      throw new ApiError(500, 'commission_update_failed', 'Commission selection could not be persisted')
    }

    return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
  },
)

const confirmCommissionAcceptance = async (c: any) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  if (!record.approved_artist_profile_id) {
    throw new ApiError(409, 'artist_not_selected', 'Select an artist before they accept this commission')
  }
  if (record.claimed_tx_hash && record.claimed_tx_hash.toLowerCase() === txHash) {
    return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const viewerProfileId = (await findMemeticsProfileByWallets(authorizedWallets))?.profile.id ?? null
  if (!viewerProfileId || viewerProfileId !== record.approved_artist_profile_id) {
    throw new ApiError(403, 'not_selected_artist', 'Only the selected artist can accept this commission')
  }

  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const claimedEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionAccepted' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  if (!claimedEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionAccepted')
  }

  const applicationId = Number((claimedEvent.args as Record<string, unknown>).applicationId ?? 0)
  const artistProfileId = Number((claimedEvent.args as Record<string, unknown>).artistProfileId ?? 0)
  if (!artistProfileId || artistProfileId !== record.approved_artist_profile_id) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain artist did not match the selected artist')
  }

  const artistProfile = await readMemeticsProfile(artistProfileId)
  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      artist_profile_id = ${artistProfileId},
      artist_wallet = ${artistProfile?.mainWallet ?? receipt.from},
      artist_handle = ${artistProfile?.handle ?? record.artist_handle},
      claimed_tx_hash = ${txHash},
      status = 'claimed',
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `
  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_applications
    SET
      status = CASE
        WHEN application_id = ${applicationId} THEN 'accepted'
        ELSE status
      END,
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission acceptance could not be persisted')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
}

commissionsRoute.post('/commissions/:commissionId/claim/confirm', requirePrivyAuth, confirmCommissionAcceptance)
commissionsRoute.post('/commissions/:commissionId/accept/confirm', requirePrivyAuth, confirmCommissionAcceptance)

commissionsRoute.post('/commissions/:commissionId/submit/confirm', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  if (!record.artist_profile_id) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  if (record.submitted_tx_hash && record.submitted_tx_hash.toLowerCase() === txHash) {
    return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const viewerProfileId = (await findMemeticsProfileByWallets(authorizedWallets))?.profile.id ?? null
  if (!viewerProfileId || viewerProfileId !== record.artist_profile_id) {
    throw new ApiError(403, 'not_artist', 'Only the assigned artist can submit work')
  }

  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const submittedEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionSubmitted' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  if (!submittedEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionSubmitted')
  }

  const deliverableUri = String((submittedEvent.args as Record<string, unknown>).deliverableURI ?? '')
  if (!deliverableUri || deliverableUri.length > MAX_URI_LENGTH) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain deliverable URI was invalid')
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      deliverable_uri = ${deliverableUri},
      submitted_tx_hash = ${txHash},
      submitted_at = NOW(),
      status = 'submitted',
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission submission could not be persisted')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
})

commissionsRoute.post('/commissions/:commissionId/approve/confirm', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord || existingRecord.requester_privy_user_id !== privyUserId) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  if (record.approved_tx_hash && record.approved_tx_hash.toLowerCase() === txHash) {
    return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const settledEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionSettled' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  if (!settledEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionSettled')
  }

  const statusCode = Number((settledEvent.args as Record<string, unknown>).status ?? 0)
  if (statusCode !== 5) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain settlement did not complete this commission')
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      approved_tx_hash = ${txHash},
      status = 'completed',
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission settlement could not be persisted')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
})

commissionsRoute.post('/commissions/:commissionId/cancel/confirm', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord || existingRecord.requester_privy_user_id !== privyUserId) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  if (record.cancelled_tx_hash && record.cancelled_tx_hash.toLowerCase() === txHash) {
    return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const cancelledEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionCancelled' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  const settledEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionSettled' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )

  if (!cancelledEvent && !settledEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit the expected cancellation events')
  }

  if (settledEvent) {
    const statusCode = Number((settledEvent.args as Record<string, unknown>).status ?? 0)
    if (statusCode !== 6) {
      throw new ApiError(409, 'unexpected_receipt', 'The onchain settlement did not cancel this commission')
    }
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      cancelled_tx_hash = ${txHash},
      status = 'cancelled',
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission cancellation could not be persisted')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
})

commissionsRoute.post('/commissions/:commissionId/payout/confirm', requirePrivyAuth, async (c) => {
  await ensureCommissionsShape()

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const commissionId = asPositiveInt(c.req.param('commissionId'))
  if (!commissionId) {
    throw new ApiError(400, 'invalid_commission', 'Invalid commission id')
  }

  const body = asObject(await c.req.json().catch(() => null))
  if (!body) {
    throw new ApiError(400, 'invalid_payload', 'Request body must be a JSON object')
  }

  const txHash = asString(body.tx_hash).toLowerCase()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const existingRecord = await getCommissionRecordByCommissionId(commissionId)
  if (!existingRecord) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  const record = await syncCommissionRecordWithChain(existingRecord)
  if (!record.artist_profile_id) {
    throw new ApiError(404, 'commission_not_found', 'Commission not found')
  }
  if (record.payout_claim_tx_hash && record.payout_claim_tx_hash.toLowerCase() === txHash) {
    return c.json(await buildCommissionDetailPayload(record, await getViewerContext(c)))
  }

  const authorizedWallets = await resolveAuthorizedEvmWallets(c, privyUserId)
  const viewerProfileId = (await findMemeticsProfileByWallets(authorizedWallets))?.profile.id ?? null
  if (!viewerProfileId || viewerProfileId !== record.artist_profile_id) {
    throw new ApiError(403, 'not_artist', 'Only the assigned artist can claim the timeout payout')
  }

  const receipt = await publicClients.base.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = decodeCommissionManagerReceiptLogs(receipt)

  const settledEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'CommissionSettled' &&
      Number((log.args as Record<string, unknown>).commissionId ?? 0) === commissionId,
  )
  if (!settledEvent) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit CommissionSettled')
  }

  const statusCode = Number((settledEvent.args as Record<string, unknown>).status ?? 0)
  if (statusCode !== 5) {
    throw new ApiError(409, 'unexpected_receipt', 'The onchain settlement did not complete this commission')
  }

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.commission_records
    SET
      payout_claim_tx_hash = ${txHash},
      status = 'completed',
      updated_at = NOW()
    WHERE commission_id = ${commissionId}
  `

  const updated = await getCommissionRecordByCommissionId(commissionId)
  if (!updated) {
    throw new ApiError(500, 'commission_update_failed', 'Commission payout claim could not be persisted')
  }

  return c.json(await buildCommissionDetailPayload(updated, await getViewerContext(c)))
})

export default commissionsRoute
