import { CONFIG, db, normalizeAddress } from '../config'
import { addHeatToDistribution, emptyTierDistribution, getTierFromHeat } from '../services/heat'
import type { ScanResult } from '../services/scanner'
import type {
  AssetPurchaseRow,
  BodegaCatalogRow,
  BodegaInstallRow,
  BonusHeatEventRow,
  BungalowSceneRow,
  BungalowWidgetInstallRow,
  BulletinPostRow,
  BungalowRow,
  FidIslandProfileRow,
  ScanLogRow,
  TokenHolderRow,
  TokenRegistryRow,
  UserWalletLinkRow,
} from './schema'
import type { DexScreenerData } from '../services/dexscreener'

const SCHEMA = `"${CONFIG.SCHEMA}"`
const MAX_HEAT = 100

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Infers wallet kind from address shape so mixed clusters can be typed consistently.
 */
function getWalletKind(wallet: string): 'evm' | 'solana' | null {
  if (normalizeAddress(wallet)) return 'evm'
  if (normalizeAddress(wallet, 'solana')) return 'solana'
  return null
}

/**
 * Layers additive bonus heat on top of scanner-derived heat without changing stored scans.
 */
async function getHeatWithBonus(
  wallet: string,
  tokenAddress: string,
  chain: string | null,
  baseHeat: number,
): Promise<number> {
  const normalizedBase = Number.isFinite(baseHeat) ? baseHeat : 0
  if (!chain) return Math.min(MAX_HEAT, normalizedBase)

  const bonus = await getBonusHeatPoints(wallet, tokenAddress, chain)
  return Math.min(MAX_HEAT, normalizedBase + bonus)
}

function isMeaningfulMetadataLabel(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  return normalized !== 'unknown' && normalized !== '?' && normalized !== 'null' && normalized !== 'token'
}

export interface RecentScanRow {
  requested_by: string
  token_address: string
  chain: string
  symbol: string | null
  completed_at: string
}

export interface DailyRefreshTokenRow {
  token_address: string
  chain: 'base' | 'ethereum' | 'solana'
  last_scanned_at: string | null
}

export async function getRecentScans(limit = 10): Promise<RecentScanRow[]> {
  return db<RecentScanRow[]>`
    SELECT
      sl.requested_by,
      sl.token_address,
      sl.chain,
      tr.symbol,
      sl.completed_at::text AS completed_at
    FROM ${db(CONFIG.SCHEMA)}.scan_log sl
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = sl.token_address
    WHERE sl.scan_status = 'complete'
    ORDER BY sl.completed_at DESC
    LIMIT ${limit}
  `
}

export async function getDailyRefreshTokens(limit = 5000): Promise<DailyRefreshTokenRow[]> {
  return db<DailyRefreshTokenRow[]>`
    SELECT
      token_address,
      chain,
      last_scanned_at::text AS last_scanned_at
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    WHERE scan_status = 'complete'
    ORDER BY last_scanned_at ASC NULLS FIRST, token_address ASC
    LIMIT ${limit}
  `
}

export async function checkDbHealth(): Promise<boolean> {
  const rows = await db<{ ok: number }[]>`SELECT 1 AS ok`
  return rows.length > 0
}

export async function getHealthSnapshot(): Promise<{
  db_connected: boolean
  personas_count: number
  bungalows_count: number
  scanned_tokens_count: number
  holder_rows_count: number
  latest_scan_at: string | null
}> {
  const [dbConnected, personasRows, bungalowsRows, scannedRows, holderRows, latestScanRows] = await Promise.all([
    checkDbHealth(),
    db<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${db(CONFIG.SCHEMA)}.fid_island_profiles
    `,
    db<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${db(CONFIG.SCHEMA)}.bungalows
    `,
    db<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${db(CONFIG.SCHEMA)}.token_registry
      WHERE scan_status = 'complete'
    `,
    db<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    `,
    db<{ ts: string | null }[]>`
      SELECT MAX(completed_at)::text AS ts
      FROM ${db(CONFIG.SCHEMA)}.scan_log
      WHERE scan_status = 'complete'
    `,
  ])

  return {
    db_connected: dbConnected,
    personas_count: Number(personasRows[0]?.cnt ?? 0),
    bungalows_count: Number(bungalowsRows[0]?.cnt ?? 0),
    scanned_tokens_count: Number(scannedRows[0]?.cnt ?? 0),
    holder_rows_count: Number(holderRows[0]?.cnt ?? 0),
    latest_scan_at: latestScanRows[0]?.ts ?? null,
  }
}

export async function getTokenRegistry(tokenAddress: string, chain?: string): Promise<TokenRegistryRow | null> {
  const rows = chain
    ? await db<TokenRegistryRow[]>`
      SELECT *
      FROM ${db(CONFIG.SCHEMA)}.token_registry
      WHERE token_address = ${tokenAddress} AND chain = ${chain}
      LIMIT 1
    `
    : await db<TokenRegistryRow[]>`
      SELECT *
      FROM ${db(CONFIG.SCHEMA)}.token_registry
      WHERE token_address = ${tokenAddress}
      LIMIT 1
    `

  return rows[0] ?? null
}

export async function findTokenDeploymentsByAddress(
  tokenAddress: string,
): Promise<Array<{ token_address: string; chain: string }>> {
  return db<Array<{ token_address: string; chain: string }>>`
    SELECT DISTINCT token_address, chain
    FROM (
      SELECT token_address, chain
      FROM ${db(CONFIG.SCHEMA)}.token_registry
      WHERE token_address = ${tokenAddress}
      UNION
      SELECT token_address, chain
      FROM ${db(CONFIG.SCHEMA)}.bungalows
      WHERE token_address = ${tokenAddress}
    ) AS matches
    ORDER BY chain ASC
  `
}

export async function getBungalow(tokenAddress: string, chain: string): Promise<BungalowRow | null> {
  const rows = await db<BungalowRow[]>`
    SELECT token_address, chain, name, symbol, ipfs_hash, current_owner, verified_admin,
           is_verified, is_claimed, description, origin_story, holder_count, total_supply,
           link_x, link_farcaster, link_telegram, link_website, link_dexscreener,
           image_url, price_usd::text AS price_usd, market_cap::text AS market_cap,
           volume_24h::text AS volume_24h, liquidity_usd::text AS liquidity_usd,
           metadata_updated_at::text AS metadata_updated_at
    FROM ${db(CONFIG.SCHEMA)}.bungalows
    WHERE token_address = ${tokenAddress} AND chain = ${chain}
    LIMIT 1
  `
  return rows[0] ?? null
}

const TIER_THRESHOLDS: Record<string, string> = {
  Elder: 'COALESCE(wfp.island_heat, 0) >= 250',
  Builder: 'COALESCE(wfp.island_heat, 0) >= 150 AND COALESCE(wfp.island_heat, 0) < 250',
  Resident: 'COALESCE(wfp.island_heat, 0) >= 80 AND COALESCE(wfp.island_heat, 0) < 150',
  Observer: 'COALESCE(wfp.island_heat, 0) >= 30 AND COALESCE(wfp.island_heat, 0) < 80',
  Drifter: '(wfp.island_heat IS NULL OR wfp.island_heat < 30)',
}

export const VALID_TIERS = Object.keys(TIER_THRESHOLDS)

export async function getTokenHolders(
  tokenAddress: string,
  limit: number,
  offset: number,
  tier?: string,
): Promise<{ holders: TokenHolderRow[]; total: number }> {
  const tierClause = tier && TIER_THRESHOLDS[tier] ? `AND ${TIER_THRESHOLDS[tier]}` : ''

  const holders = await db.unsafe<TokenHolderRow[]>(
    `SELECT
      thh.wallet,
      thh.heat_degrees,
      wfp.island_heat,
      wfp.fid,
      wfp.username,
      wfp.pfp_url
    FROM "${CONFIG.SCHEMA}".token_holder_heat thh
    LEFT JOIN "${CONFIG.SCHEMA}".wallet_farcaster_profiles wfp
      ON wfp.wallet = thh.wallet
    WHERE thh.token_address = $1
    ${tierClause}
    ORDER BY thh.heat_degrees DESC
    LIMIT $2
    OFFSET $3`,
    [tokenAddress, limit, offset],
  )

  const totalRows = await db.unsafe<{ cnt: string }[]>(
    `SELECT COUNT(*)::text AS cnt
    FROM "${CONFIG.SCHEMA}".token_holder_heat thh
    LEFT JOIN "${CONFIG.SCHEMA}".wallet_farcaster_profiles wfp
      ON wfp.wallet = thh.wallet
    WHERE thh.token_address = $1
    ${tierClause}`,
    [tokenAddress],
  )

  return {
    holders,
    total: Number(totalRows[0]?.cnt ?? 0),
  }
}

export async function getTokenHeatDistribution(tokenAddress: string) {
  // Use per-token heat_degrees for tier distribution (not island_heat)
  // This gives accurate tier breakdowns for this specific token
  const rows = await db<{ heat_degrees: string }[]>`
    SELECT heat_degrees
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${tokenAddress}
  `

  const distribution = emptyTierDistribution()
  for (const row of rows) {
    addHeatToDistribution(distribution, Number(row.heat_degrees ?? 0))
  }
  return distribution
}

export async function getViewerProfile(wallet: string): Promise<{
  wallet: string
  fid: number | null
  islandHeat: number
  tier: string
} | null> {
  const rows = await db<{ fid: number | null; island_heat: string | null; tier: string | null }[]>`
    SELECT
      wfp.fid,
      COALESCE(fip.island_heat, wfp.island_heat, hp.island_heat, 0) AS island_heat,
      COALESCE(fip.tier, 'Drifter') AS tier
    FROM (
      SELECT MAX(island_heat) AS island_heat
      FROM ${db(CONFIG.SCHEMA)}.heat_precalculated
      WHERE wallet = ${wallet}
    ) hp
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = ${wallet}
    LEFT JOIN ${db(CONFIG.SCHEMA)}.fid_island_profiles fip
      ON fip.fid = wfp.fid
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  const islandHeat = Number(row.island_heat ?? 0)
  return {
    wallet,
    fid: row.fid,
    islandHeat,
    tier: row.tier ?? getTierFromHeat(islandHeat),
  }
}

export async function getWalletTokenHeat(tokenAddress: string, wallet: string): Promise<number | null> {
  const rows = await db<{ heat_degrees: string }[]>`
    SELECT heat_degrees
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${tokenAddress} AND wallet = ${wallet}
    LIMIT 1
  `
  if (!rows[0]) return null
  return Number(rows[0].heat_degrees)
}

export async function getWalletTokenHeats(
  tokenAddress: string,
  wallets: string[],
): Promise<Array<{ wallet: string; heat_degrees: number }>> {
  const uniqueWallets = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))]
  if (uniqueWallets.length === 0) return []

  const rows = await db<Array<{ wallet: string; heat_degrees: string }>>`
    SELECT wallet, heat_degrees::text AS heat_degrees
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${tokenAddress}
      AND wallet IN ${db(uniqueWallets)}
  `

  return rows.map((row) => ({
    wallet: row.wallet,
    heat_degrees: Number(row.heat_degrees),
  }))
}

export async function getDailyAllowanceUsed(wallet: string, date: string): Promise<number> {
  const rows = await db<{ scans_used: number }[]>`
    SELECT scans_used
    FROM ${db(CONFIG.SCHEMA)}.scan_allowance
    WHERE wallet = ${wallet} AND date = ${date}
    LIMIT 1
  `
  return Number(rows[0]?.scans_used ?? 0)
}

export async function incrementDailyAllowance(wallet: string, date: string): Promise<void> {
  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.scan_allowance (wallet, date, scans_used)
    VALUES (${wallet}, ${date}, 1)
    ON CONFLICT (wallet, date)
    DO UPDATE SET scans_used = ${db(CONFIG.SCHEMA)}.scan_allowance.scans_used + 1
  `
}

// ─── Holder Balance Snapshots ────────────────────────────────
let holderBalanceSnapshotsTablePromise: Promise<void> | null = null

async function ensureHolderBalanceSnapshotsTable(): Promise<void> {
  if (!holderBalanceSnapshotsTablePromise) {
    holderBalanceSnapshotsTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.holder_balance_snapshots (
          token_address TEXT NOT NULL,
          wallet TEXT NOT NULL,
          ts INTEGER NOT NULL,
          balance TEXT NOT NULL,
          PRIMARY KEY (token_address, wallet, ts)
        )
      `
      await db`
        CREATE INDEX IF NOT EXISTS idx_hbs_token_wallet
        ON ${db(CONFIG.SCHEMA)}.holder_balance_snapshots (token_address, wallet)
      `
    })()
  }
  await holderBalanceSnapshotsTablePromise
}

export async function getHolderBalanceHistory(
  tokenAddress: string,
  wallet: string,
): Promise<Array<{ ts: number; balance: string }>> {
  await ensureHolderBalanceSnapshotsTable()

  const rows = await db<Array<{ ts: number; balance: string }>>`
    SELECT ts, balance
    FROM ${db(CONFIG.SCHEMA)}.holder_balance_snapshots
    WHERE token_address = ${tokenAddress} AND wallet = ${wallet}
    ORDER BY ts ASC
  `
  return rows
}

let timelineColumnPromise: Promise<void> | null = null

async function ensureTimelineColumn(): Promise<void> {
  if (!timelineColumnPromise) {
    timelineColumnPromise = (async () => {
      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.token_registry
        ADD COLUMN IF NOT EXISTS transfer_timeline JSONB
      `
    })()
  }
  await timelineColumnPromise
}

let scanLogProgressColumnsPromise: Promise<void> | null = null

async function ensureScanLogProgressColumns(): Promise<void> {
  if (!scanLogProgressColumnsPromise) {
    scanLogProgressColumnsPromise = (async () => {
      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.scan_log
        ADD COLUMN IF NOT EXISTS progress_phase TEXT
      `

      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.scan_log
        ADD COLUMN IF NOT EXISTS progress_pct NUMERIC
      `

      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.scan_log
        ADD COLUMN IF NOT EXISTS progress_detail TEXT
      `
    })()
  }

  await scanLogProgressColumnsPromise
}

export async function setTokenStatus(tokenAddress: string, chain: string, status: string): Promise<void> {
  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.token_registry (token_address, chain, scan_status)
    VALUES (${tokenAddress}, ${chain}, ${status})
    ON CONFLICT (token_address)
    DO UPDATE SET scan_status = EXCLUDED.scan_status
  `
}

export async function getLatestScanByToken(tokenAddress: string): Promise<ScanLogRow | null> {
  const rows = await db<ScanLogRow[]>`
    SELECT *
    FROM ${db(CONFIG.SCHEMA)}.scan_log
    WHERE token_address = ${tokenAddress}
    ORDER BY id DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function createScanLog(input: {
  tokenAddress: string
  chain: string
  requestedBy: string
  requesterFid: number | null
  requesterTier: string | null
  paymentMethod: 'free_resident' | 'x402_usdc' | 'admin'
  paymentAmount: number
}): Promise<number> {
  await ensureScanLogProgressColumns()

  const rows = await db<{ id: number }[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.scan_log (
      token_address,
      chain,
      requested_by,
      requester_fid,
      requester_tier,
      payment_method,
      payment_amount,
      scan_status
    )
    VALUES (
      ${input.tokenAddress},
      ${input.chain},
      ${input.requestedBy},
      ${input.requesterFid},
      ${input.requesterTier},
      ${input.paymentMethod},
      ${input.paymentAmount},
      'running'
    )
    RETURNING id
  `
  return rows[0].id
}

export async function getScanLog(scanId: number): Promise<ScanLogRow | null> {
  await ensureScanLogProgressColumns()

  const rows = await db<ScanLogRow[]>`
    SELECT *
    FROM ${db(CONFIG.SCHEMA)}.scan_log
    WHERE id = ${scanId}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function markScanFailed(scanId: number, tokenAddress: string, message: string): Promise<void> {
  await ensureScanLogProgressColumns()

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.scan_log
    SET
      scan_status = 'failed',
      progress_phase = 'failed',
      progress_pct = 100,
      completed_at = NOW(),
      error_message = ${message}
    WHERE id = ${scanId}
  `

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.token_registry
    SET scan_status = 'failed', last_scanned_at = NOW()
    WHERE token_address = ${tokenAddress}
  `
}

export async function updateScanProgress(
  scanId: number,
  progress: { phase: string; pct: number; detail?: string },
): Promise<void> {
  await ensureScanLogProgressColumns()

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.scan_log
    SET
      progress_phase = ${progress.phase},
      progress_pct = ${Math.max(0, Math.min(100, progress.pct))},
      progress_detail = ${progress.detail ?? null},
      completed_at = CASE WHEN ${progress.pct >= 100} THEN NOW() ELSE completed_at END
    WHERE id = ${scanId}
  `
}

export async function writeScanResult(scanId: number, result: ScanResult, onProgress?: (progress: { phase: string; pct: number; detail?: string }) => void): Promise<void> {
  await ensureScanLogProgressColumns()
  await ensureTimelineColumn()
  await ensureHolderBalanceSnapshotsTable()

  const existingRegistry = await db<Array<{
    name: string | null
    symbol: string | null
    is_home_team: boolean | null
  }>>`
    SELECT name, symbol, is_home_team
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    WHERE token_address = ${result.tokenAddress}
    LIMIT 1
  `

  const current = existingRegistry[0]
  const hasHomeTeamName = isMeaningfulMetadataLabel(current?.name)
  const hasHomeTeamSymbol = isMeaningfulMetadataLabel(current?.symbol)
  const preferredName =
    current?.is_home_team && hasHomeTeamName ? current.name ?? result.name : result.name
  const preferredSymbol =
    current?.is_home_team && hasHomeTeamSymbol ? current.symbol ?? result.symbol : result.symbol

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.token_registry (
      token_address, chain, name, symbol, decimals, total_supply,
      deploy_block, deploy_timestamp, scan_status, last_scanned_at,
      last_scan_block, holder_count
    )
    VALUES (
      ${result.tokenAddress}, ${result.chain}, ${preferredName}, ${preferredSymbol}, ${result.decimals},
      ${result.totalSupply}, ${result.deployBlock}, ${result.deployTimestamp}, 'complete', NOW(),
      ${result.deployBlock}, ${result.holderCount}
    )
    ON CONFLICT (token_address) DO UPDATE SET
      chain = EXCLUDED.chain,
      name = EXCLUDED.name,
      symbol = EXCLUDED.symbol,
      decimals = EXCLUDED.decimals,
      total_supply = EXCLUDED.total_supply,
      deploy_block = EXCLUDED.deploy_block,
      deploy_timestamp = EXCLUDED.deploy_timestamp,
      scan_status = 'complete',
      last_scanned_at = NOW(),
      last_scan_block = EXCLUDED.last_scan_block,
      holder_count = EXCLUDED.holder_count
  `

  // Persist transfer timeline
  if (result.timeline && result.timeline.length > 0) {
    await db`
      UPDATE ${db(CONFIG.SCHEMA)}.token_registry
      SET transfer_timeline = ${JSON.stringify(result.timeline)}::jsonb
      WHERE token_address = ${result.tokenAddress}
    `
  }

  await db`
    DELETE FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${result.tokenAddress}
  `

  // Deduplicate holders by wallet (a wallet can have multiple token accounts on Solana)
  const deduped = new Map<string, typeof result.holders[0]>()
  for (const holder of result.holders) {
    const existing = deduped.get(holder.wallet)
    if (existing) {
      existing.balanceRaw = (BigInt(existing.balanceRaw) + BigInt(holder.balanceRaw)).toString()
      existing.heatDegrees = Math.max(existing.heatDegrees, holder.heatDegrees)
      existing.firstSeenAt = Math.min(existing.firstSeenAt, holder.firstSeenAt)
      existing.lastTransferAt = Math.max(existing.lastTransferAt, holder.lastTransferAt)
    } else {
      deduped.set(holder.wallet, { ...holder })
    }
  }

  const holderRows = [...deduped.values()].map((holder) => ({
    token_address: result.tokenAddress,
    wallet: holder.wallet,
    heat_degrees: holder.heatDegrees,
    balance_raw: holder.balanceRaw,
    first_seen_at: holder.firstSeenAt,
    last_transfer_at: holder.lastTransferAt,
  }))

  const BATCH_SIZE = 500
  for (let i = 0; i < holderRows.length; i += BATCH_SIZE) {
    const batch = holderRows.slice(i, i + BATCH_SIZE)
    if (batch.length === 0) break
    await db`
      INSERT INTO ${db(CONFIG.SCHEMA)}.token_holder_heat ${db(
        batch,
        'token_address',
        'wallet',
        'heat_degrees',
        'balance_raw',
        'first_seen_at',
        'last_transfer_at',
      )}
    `
  }

  // Persist holder balance snapshots
  onProgress?.({ phase: 'saving', pct: 85, detail: 'Saving balance snapshots' })
  if (result.holderSnapshots && result.holderSnapshots.size > 0) {
    const snapStart = Date.now()
    await db`
      DELETE FROM ${db(CONFIG.SCHEMA)}.holder_balance_snapshots
      WHERE token_address = ${result.tokenAddress}
    `

    const snapshotRows: Array<{ token_address: string; wallet: string; ts: number; balance: string }> = []
    for (const [wallet, snaps] of result.holderSnapshots.entries()) {
      for (const snap of snaps) {
        snapshotRows.push({
          token_address: result.tokenAddress,
          wallet,
          ts: snap.ts,
          balance: snap.balance,
        })
      }
    }

    const SNAP_BATCH_SIZE = 2000
    for (let i = 0; i < snapshotRows.length; i += SNAP_BATCH_SIZE) {
      const batch = snapshotRows.slice(i, i + SNAP_BATCH_SIZE)
      if (batch.length === 0) break
      await db`
        INSERT INTO ${db(CONFIG.SCHEMA)}.holder_balance_snapshots ${db(
          batch,
          'token_address',
          'wallet',
          'ts',
          'balance',
        )}
        ON CONFLICT (token_address, wallet, ts) DO UPDATE SET
          balance = EXCLUDED.balance
      `
      // Update progress: 85% to 95% across snapshot batches
      const pct = Math.round(85 + 10 * ((i + batch.length) / snapshotRows.length))
      onProgress?.({ phase: 'saving', pct, detail: `${Math.round((i + batch.length) / 1000)}k / ${Math.round(snapshotRows.length / 1000)}k snapshots saved` })
    }
    console.log(`[SNAPSHOTS DB] Persisted ${snapshotRows.length} snapshot rows for ${result.holderSnapshots.size} wallets in ${Date.now() - snapStart}ms`)
  } else {
    console.log(`[SNAPSHOTS DB] No holderSnapshots to persist (size=${result.holderSnapshots?.size ?? 0})`)
  }
  onProgress?.({ phase: 'saving', pct: 97, detail: 'Finalizing' })

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
      token_address, chain, name, symbol, holder_count, total_supply, updated_at
    )
    VALUES (
      ${result.tokenAddress}, ${result.chain}, ${preferredName}, ${preferredSymbol}, ${result.holderCount}, ${result.totalSupply}, NOW()
    )
    ON CONFLICT (token_address) DO UPDATE SET
      chain = EXCLUDED.chain,
      name = EXCLUDED.name,
      symbol = EXCLUDED.symbol,
      holder_count = EXCLUDED.holder_count,
      total_supply = EXCLUDED.total_supply,
      updated_at = NOW()
  `

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.scan_log
    SET scan_status = 'complete',
        events_fetched = ${result.eventsFetched},
        holders_found = ${result.holderCount},
        rpc_calls_made = ${result.rpcCallsMade},
        progress_phase = 'complete',
        progress_pct = 100,
        completed_at = NOW(),
        error_message = NULL
    WHERE id = ${scanId}
  `
}

export async function getPersona(fid: number): Promise<FidIslandProfileRow | null> {
  const rows = await db<FidIslandProfileRow[]>`
    SELECT *
    FROM ${db(CONFIG.SCHEMA)}.fid_island_profiles
    WHERE fid = ${fid}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function getPersonaScans(fid: number): Promise<Array<{ token_address: string; name: string | null; scanned_at: string }>> {
  return db<Array<{ token_address: string; name: string | null; scanned_at: string }>>`
    SELECT
      sl.token_address,
      tr.name,
      sl.completed_at::text AS scanned_at
    FROM ${db(CONFIG.SCHEMA)}.scan_log sl
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = sl.token_address
    WHERE sl.requester_fid = ${fid}
      AND sl.scan_status = 'complete'
      AND sl.completed_at IS NOT NULL
    ORDER BY sl.completed_at DESC
    LIMIT 200
  `
}

export async function getLeaderboard(input: {
  tier?: string
  token?: string
  limit: number
  offset: number
}): Promise<{
  personas: Array<{
    fid: number
    username: string
    pfp_url: string
    island_heat: number
    tier: string
    wallet_count: number
    top_tokens: { token_name: string; heat_degrees: number }[]
  }>
  total: number
  tiers: { elders: number; builders: number; residents: number; observers: number; drifters: number }
}> {
  const whereParts: string[] = []
  const params: Array<string | number> = []

  if (input.tier) {
    params.push(input.tier)
    whereParts.push(`fip.tier = $${params.length}`)
  }

  if (input.token) {
    params.push(input.token)
    whereParts.push(`EXISTS (
      SELECT 1
      FROM ${SCHEMA}.wallet_farcaster_profiles wfp
      JOIN ${SCHEMA}.token_holder_heat thh ON thh.wallet = wfp.wallet
      WHERE wfp.fid = fip.fid AND thh.token_address = $${params.length}
    )`)
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

  const totalParams = [...params]
  const totalQuery = `
    SELECT COUNT(*)::text AS cnt
    FROM ${SCHEMA}.fid_island_profiles fip
    ${whereClause}
  `
  const totalRows = await db.unsafe<{ cnt: string }[]>(totalQuery, totalParams as any[])
  const total = Number(totalRows[0]?.cnt ?? 0)

  const pageParams = [...params, input.limit, input.offset]
  const listQuery = `
    SELECT fid, username, pfp_url, island_heat::text AS island_heat, tier, wallet_count, token_breakdown
    FROM ${SCHEMA}.fid_island_profiles fip
    ${whereClause}
    ORDER BY island_heat DESC
    LIMIT $${pageParams.length - 1}
    OFFSET $${pageParams.length}
  `
  const rows = await db.unsafe<Array<{
    fid: number
    username: string
    pfp_url: string
    island_heat: string
    tier: string
    wallet_count: number
    token_breakdown: unknown
  }>>(listQuery, pageParams as any[])

  const personas = rows.map((row) => {
    const breakdown = parseJsonArray<{ token_name: string; heat_degrees: number }>(row.token_breakdown)
      .sort((a, b) => b.heat_degrees - a.heat_degrees)
      .slice(0, 3)
    return {
      fid: row.fid,
      username: row.username,
      pfp_url: row.pfp_url,
      island_heat: Number(row.island_heat),
      tier: row.tier,
      wallet_count: row.wallet_count,
      top_tokens: breakdown,
    }
  })

  const tiers = emptyTierDistribution()
  const tierRows = await db.unsafe<Array<{ tier: string; cnt: string }>>(
    `
    SELECT tier, COUNT(*)::text AS cnt
    FROM ${SCHEMA}.fid_island_profiles fip
    ${whereClause}
    GROUP BY tier
  `,
    params as any[],
  )

  for (const row of tierRows) {
    const count = Number(row.cnt)
    if (row.tier === 'Elder') tiers.elders = count
    if (row.tier === 'Builder') tiers.builders = count
    if (row.tier === 'Resident') tiers.residents = count
    if (row.tier === 'Observer') tiers.observers = count
    if (row.tier === 'Drifter') tiers.drifters = count
  }

  return { personas, total, tiers }
}

export async function getBungalowsDirectory(input: {
  limit: number
  offset: number
}): Promise<{
  items: Array<{
    chain: string
    token_address: string
    name: string | null
    symbol: string | null
    holder_count: number
    image_url: string | null
    is_claimed: boolean
    scan_status: string
  }>
  total: number
}> {
  const listRows = await db<Array<{
    chain: string
    token_address: string
    name: string | null
    symbol: string | null
    holder_count: number
    image_url: string | null
    is_claimed: boolean
    scan_status: string
  }>>`
    SELECT
      tr.chain,
      tr.token_address,
      COALESCE(b.name, tr.name) AS name,
      COALESCE(b.symbol, tr.symbol) AS symbol,
      tr.holder_count,
      b.image_url,
      COALESCE(b.is_claimed, false) AS is_claimed,
      tr.scan_status
    FROM ${db(CONFIG.SCHEMA)}.token_registry tr
    LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalows b
      ON b.token_address = tr.token_address AND b.chain = tr.chain
    WHERE tr.scan_status = 'complete'
    ORDER BY tr.last_scanned_at DESC NULLS LAST, tr.holder_count DESC
    LIMIT ${input.limit}
    OFFSET ${input.offset}
  `

  const totalRows = await db<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${db(CONFIG.SCHEMA)}.token_registry tr
    WHERE tr.scan_status = 'complete'
  `

  return {
    items: listRows,
    total: Number(totalRows[0]?.cnt ?? 0),
  }
}

export async function getUserByWallet(wallet: string): Promise<{
  wallet: string
  island_heat: number
  tier: string
  farcaster: {
    fid: number | null
    username: string | null
    display_name: string | null
    pfp_url: string | null
  } | null
  token_breakdown: Array<{ token: string; token_name: string; token_symbol: string | null; chain: string | null; heat_degrees: number }>
  scans: Array<{ chain: string; token_address: string; scanned_at: string }>
} | null> {
  const profileRows = await db<Array<{
    wallet: string
    fid: number | null
    username: string | null
    display_name: string | null
    pfp_url: string | null
    island_heat: string | null
    tier: string | null
  }>>`
    SELECT
      ${wallet}::text AS wallet,
      wfp.fid,
      COALESCE(wfp.username, fip.username) AS username,
      fip.display_name,
      COALESCE(wfp.pfp_url, fip.pfp_url) AS pfp_url,
      COALESCE(fip.island_heat, wfp.island_heat, hp.island_heat, 0)::text AS island_heat,
      COALESCE(fip.tier, ${getTierFromHeat(0)}) AS tier
    FROM (
      SELECT MAX(island_heat) AS island_heat
      FROM ${db(CONFIG.SCHEMA)}.heat_precalculated
      WHERE wallet = ${wallet}
    ) hp
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = ${wallet}
    LEFT JOIN ${db(CONFIG.SCHEMA)}.fid_island_profiles fip
      ON fip.fid = wfp.fid
    LIMIT 1
  `

  const tokenRows = await db<Array<{ token: string; token_name: string | null; token_symbol: string | null; chain: string | null; heat_degrees: string }>>`
    SELECT
      thh.token_address AS token,
      tr.name AS token_name,
      tr.symbol AS token_symbol,
      tr.chain,
      thh.heat_degrees::text AS heat_degrees
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat thh
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = thh.token_address
    WHERE thh.wallet = ${wallet}
    ORDER BY thh.heat_degrees DESC
    LIMIT 200
  `

  const scanRows = await db<Array<{ chain: string; token_address: string; scanned_at: string }>>`
    SELECT
      sl.chain,
      sl.token_address,
      sl.completed_at::text AS scanned_at
    FROM ${db(CONFIG.SCHEMA)}.scan_log sl
    WHERE sl.requested_by = ${wallet}
      AND sl.scan_status = 'complete'
      AND sl.completed_at IS NOT NULL
    ORDER BY sl.completed_at DESC
    LIMIT 200
  `

  const profile = profileRows[0] ?? null
  const hasIdentity = Boolean(profile?.fid || profile?.username || profile?.display_name || profile?.pfp_url)
  const hasData = tokenRows.length > 0 || scanRows.length > 0
  if (!profile && !hasData) return null

  const tokenBreakdown = await Promise.all(
    tokenRows.map(async (row) => {
      const adjustedHeat = await getHeatWithBonus(
        wallet,
        row.token,
        row.chain ?? null,
        Number(row.heat_degrees),
      )

      return {
        token: row.token,
        token_name: row.token_name ?? row.token,
        token_symbol: row.token_symbol ?? null,
        chain: row.chain ?? null,
        heat_degrees: adjustedHeat,
      }
    }),
  )

  const fallbackIslandHeat = Number(profile?.island_heat ?? 0)
  const islandHeat = tokenBreakdown.length > 0
    ? tokenBreakdown.reduce((sum, row) => sum + row.heat_degrees, 0)
    : fallbackIslandHeat
  const tier = getTierFromHeat(islandHeat)

  if (!hasIdentity && !hasData && islandHeat <= 0) return null

  return {
    wallet,
    island_heat: islandHeat,
    tier,
    farcaster: hasIdentity
      ? {
          fid: profile?.fid ?? null,
          username: profile?.username ?? null,
          display_name: profile?.display_name ?? null,
          pfp_url: profile?.pfp_url ?? null,
        }
      : null,
    token_breakdown: tokenBreakdown,
    scans: scanRows,
  }
}

// ─── Linked Wallets Lookup ─────────────────────────────────
export async function getLinkedWalletsByWallet(wallet: string): Promise<{
  x_id: string
  x_username: string | null
  wallets: Array<{ wallet: string; wallet_kind: string }>
} | null> {
  await ensureUserWalletLinksTable()

  const normalizedWallet = normalizeAddress(wallet) ?? normalizeAddress(wallet, 'solana')
  if (!normalizedWallet) return null

  const directRows = await db<Array<{ primary_wallet: string | null; linked_wallet: string | null }>>`
    SELECT primary_wallet, linked_wallet
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE primary_wallet = ${normalizedWallet}
       OR linked_wallet = ${normalizedWallet}
  `

  const primaryWallets = new Set<string>()
  for (const row of directRows) {
    if (row.primary_wallet) {
      primaryWallets.add(row.primary_wallet)
    }
  }

  const primaryList = [...primaryWallets]
  const clusterRows = primaryList.length > 0
    ? await db<Array<{ primary_wallet: string | null; linked_wallet: string | null }>>`
      SELECT primary_wallet, linked_wallet
      FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
      WHERE primary_wallet IN ${db(primaryList)}
    `
    : []

  const walletMap = new Map<string, { wallet: string; wallet_kind: string }>()
  for (const candidate of [normalizedWallet, ...primaryList]) {
    const walletKind = getWalletKind(candidate)
    if (!walletKind) continue
    walletMap.set(`${walletKind}:${candidate}`, {
      wallet: candidate,
      wallet_kind: walletKind,
    })
  }

  for (const row of clusterRows) {
    for (const candidate of [row.primary_wallet, row.linked_wallet]) {
      if (!candidate) continue
      const walletKind = getWalletKind(candidate)
      if (!walletKind) continue
      walletMap.set(`${walletKind}:${candidate}`, {
        wallet: candidate,
        wallet_kind: walletKind,
      })
    }
  }

  if (walletMap.size === 0) return null

  return {
    x_id: `wallet:${normalizedWallet}`,
    x_username: null,
    wallets: [...walletMap.values()],
  }
}

// ─── Aggregated User Profile (multi-wallet) ───────────────
export async function getAggregatedUserByWallets(wallets: string[]): Promise<{
  island_heat: number
  tier: string
  token_breakdown: Array<{
    token: string
    token_name: string
    token_symbol: string | null
    chain: string | null
    heat_degrees: number
    wallet_heats: Array<{ wallet: string; heat_degrees: number }>
  }>
  scans: Array<{ chain: string; token_address: string; scanned_at: string }>
} | null> {
  if (wallets.length === 0) return null

  // Aggregate token heat across all wallets, grouped by token
  const tokenRows = await db<Array<{
    token: string
    token_name: string | null
    token_symbol: string | null
    chain: string | null
    total_heat: string
    wallet_heats: string
  }>>`
    SELECT
      thh.token_address AS token,
      tr.name AS token_name,
      tr.symbol AS token_symbol,
      tr.chain,
      SUM(thh.heat_degrees)::text AS total_heat,
      json_agg(json_build_object('wallet', thh.wallet, 'heat_degrees', thh.heat_degrees))::text AS wallet_heats
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat thh
    LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr
      ON tr.token_address = thh.token_address
    WHERE thh.wallet IN ${db(wallets)}
    GROUP BY thh.token_address, tr.name, tr.symbol, tr.chain
    ORDER BY SUM(thh.heat_degrees) DESC
    LIMIT 200
  `

  // Aggregate scans across all wallets (dedup by token)
  const scanRows = await db<Array<{ chain: string; token_address: string; scanned_at: string }>>`
    SELECT DISTINCT ON (sl.token_address)
      sl.chain,
      sl.token_address,
      sl.completed_at::text AS scanned_at
    FROM ${db(CONFIG.SCHEMA)}.scan_log sl
    WHERE sl.requested_by IN ${db(wallets)}
      AND sl.scan_status = 'complete'
      AND sl.completed_at IS NOT NULL
    ORDER BY sl.token_address, sl.completed_at DESC
  `

  const tokenBreakdown = await Promise.all(
    tokenRows.map(async (row) => {
      let walletHeats: Array<{ wallet: string; heat_degrees: number }> = []
      try {
        walletHeats = JSON.parse(row.wallet_heats)
      } catch {}

      const adjustedWalletHeats = await Promise.all(
        walletHeats.map(async (walletHeat) => ({
          wallet: walletHeat.wallet,
          heat_degrees: await getHeatWithBonus(
            walletHeat.wallet,
            row.token,
            row.chain ?? null,
            Number(walletHeat.heat_degrees),
          ),
        })),
      )

      const totalHeat = adjustedWalletHeats.reduce(
        (sum, walletHeat) => sum + walletHeat.heat_degrees,
        0,
      )

      return {
        token: row.token,
        token_name: row.token_name ?? row.token,
        token_symbol: row.token_symbol ?? null,
        chain: row.chain ?? null,
        heat_degrees: totalHeat,
        wallet_heats: adjustedWalletHeats,
      }
    }),
  )

  const islandHeat = tokenBreakdown.reduce((sum, t) => sum + t.heat_degrees, 0)

  return {
    island_heat: islandHeat,
    tier: getTierFromHeat(islandHeat),
    token_breakdown: tokenBreakdown,
    scans: scanRows,
  }
}

export async function upsertWalletFarcasterProfile(
  wallet: string,
  fid: number,
  username: string,
  displayName: string,
  pfpUrl: string,
): Promise<void> {
  const normalizedWallet = normalizeAddress(wallet) ?? normalizeAddress(wallet, 'solana') ?? wallet.trim()

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles
      (wallet, fid, username, display_name, pfp_url, resolved_at)
    VALUES
      (${normalizedWallet}, ${fid}, ${username}, ${displayName}, ${pfpUrl}, NOW())
    ON CONFLICT (wallet) DO UPDATE SET
      fid = EXCLUDED.fid,
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      pfp_url = EXCLUDED.pfp_url,
      resolved_at = NOW()
  `
}

export async function getWalletsByFid(fid: number): Promise<string[]> {
  const rows = await db<Array<{ wallet: string }>>`
    SELECT wallet
    FROM ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles
    WHERE fid = ${fid}
    ORDER BY resolved_at ASC
  `
  return rows.map((r) => r.wallet)
}

let userWalletLinksTablePromise: Promise<void> | null = null

async function ensureUserWalletLinksTable(): Promise<void> {
  if (!userWalletLinksTablePromise) {
    userWalletLinksTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.user_wallet_links (
          id BIGSERIAL PRIMARY KEY,
          primary_wallet TEXT NOT NULL,
          linked_wallet TEXT NOT NULL,
          verification_signature TEXT NOT NULL,
          verification_message TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (primary_wallet, linked_wallet)
        )
      `

      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
      )
      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS primary_wallet TEXT`,
      )
      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS linked_wallet TEXT`,
      )
      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS verification_signature TEXT`,
      )
      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS verification_message TEXT`,
      )
      await db.unsafe(
        `ALTER TABLE "${CONFIG.SCHEMA}".user_wallet_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      )

      await db.unsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallet_links_primary_linked_unique
        ON "${CONFIG.SCHEMA}".user_wallet_links (primary_wallet, linked_wallet)
        WHERE primary_wallet IS NOT NULL AND linked_wallet IS NOT NULL
      `)

      await db`
        CREATE INDEX IF NOT EXISTS idx_user_wallet_links_primary_wallet
        ON ${db(CONFIG.SCHEMA)}.user_wallet_links (primary_wallet)
      `

      await db`
        CREATE INDEX IF NOT EXISTS idx_user_wallet_links_linked_wallet
        ON ${db(CONFIG.SCHEMA)}.user_wallet_links (linked_wallet)
      `
    })()
  }

  await userWalletLinksTablePromise
}

export interface UserWalletLinkUpsertRow {
  wallet: string
  wallet_kind: 'evm' | 'solana'
  seen_via_privy: boolean
  seen_via_farcaster: boolean
  farcaster_verified: boolean
  last_seen_requester_wallet: boolean
}

export interface IdentityClusterWallet {
  wallet: string
  wallet_kind: 'evm' | 'solana'
  linked_via_privy: boolean
  linked_via_farcaster: boolean
  farcaster_verified: boolean
  is_requester_wallet: boolean
}

export interface IdentityCluster {
  identity_key: string
  identity_source: 'privy' | 'farcaster' | 'wallet'
  identity_value: string
  wallets: IdentityClusterWallet[]
  evm_wallets: string[]
  solana_wallets: string[]
  x_username: string | null
  farcaster: {
    fid: number
    username: string | null
    display_name: string | null
    pfp_url: string | null
  } | null
}

export async function upsertUserWalletLinks(input: {
  privyUserId: string | null
  fid: number | null
  xUsername: string | null
  rows: UserWalletLinkUpsertRow[]
}): Promise<void> {
  void input
}

export async function getIdentityClusterByWallet(wallet: string): Promise<IdentityCluster | null> {
  await ensureUserWalletLinksTable()

  const normalizedWallet = normalizeAddress(wallet) ?? normalizeAddress(wallet, 'solana')
  if (!normalizedWallet) return null
  const requesterKind = getWalletKind(normalizedWallet)
  if (!requesterKind) return null

  const directRows = await db<Array<{ primary_wallet: string | null; linked_wallet: string | null }>>`
    SELECT primary_wallet, linked_wallet
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE primary_wallet = ${normalizedWallet}
       OR linked_wallet = ${normalizedWallet}
  `

  const primaryWallets = new Set<string>()
  for (const row of directRows) {
    if (row.primary_wallet) {
      primaryWallets.add(row.primary_wallet)
    }
  }

  const primaryList = [...primaryWallets]
  const clusterRows = primaryList.length > 0
    ? await db<Array<{ primary_wallet: string | null; linked_wallet: string | null }>>`
      SELECT primary_wallet, linked_wallet
      FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
      WHERE primary_wallet IN ${db(primaryList)}
    `
    : []

  const dedup = new Map<string, IdentityClusterWallet>()
  // Fold manual link rows into one typed cluster map without duplicating wallets.
  const addClusterWallet = (candidate: string | null): void => {
    if (!candidate) return
    const walletKind = getWalletKind(candidate)
    if (!walletKind) return

    const key = `${walletKind}:${candidate}`
    const existing = dedup.get(key)
    if (existing) {
      existing.is_requester_wallet = existing.is_requester_wallet || candidate === normalizedWallet
      return
    }

    dedup.set(key, {
      wallet: candidate,
      wallet_kind: walletKind,
      linked_via_privy: false,
      linked_via_farcaster: false,
      farcaster_verified: false,
      is_requester_wallet: candidate === normalizedWallet,
    })
  }

  addClusterWallet(normalizedWallet)
  for (const candidate of primaryList) {
    addClusterWallet(candidate)
  }
  for (const row of clusterRows) {
    addClusterWallet(row.primary_wallet)
    addClusterWallet(row.linked_wallet)
  }

  const wallets = [...dedup.values()]
  const clusterWallets = wallets.map((entry) => entry.wallet)

  const farcasterRows = clusterWallets.length > 0
    ? await db<Array<{
      wallet: string
      fid: number | null
      username: string | null
      display_name: string | null
      pfp_url: string | null
    }>>`
      SELECT wallet, fid, username, display_name, pfp_url
      FROM ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles
      WHERE wallet IN ${db(clusterWallets)}
      ORDER BY CASE WHEN wallet = ${normalizedWallet} THEN 0 ELSE 1 END, resolved_at DESC
    `
    : []

  const verifiedWallets = new Set(
    farcasterRows
      .filter((row) => row.fid !== null)
      .map((row) => row.wallet),
  )

  for (const entry of wallets) {
    if (!verifiedWallets.has(entry.wallet)) continue
    entry.linked_via_farcaster = true
    entry.farcaster_verified = true
  }

  const farcasterProfile = farcasterRows.find((row) => row.fid !== null) ?? null
  const farcaster = farcasterProfile?.fid
    ? {
        fid: Number(farcasterProfile.fid),
        username: farcasterProfile.username,
        display_name: farcasterProfile.display_name,
        pfp_url: farcasterProfile.pfp_url,
      }
    : null

  const identitySource: 'privy' | 'farcaster' | 'wallet' = farcaster && primaryList.length === 0
    ? 'farcaster'
    : 'wallet'
  const identityValue = identitySource === 'farcaster'
    ? String(farcaster?.fid ?? normalizedWallet)
    : primaryList[0] ?? normalizedWallet

  return {
    identity_key: `${identitySource}:${identityValue}`,
    identity_source: identitySource,
    identity_value: identityValue,
    wallets,
    evm_wallets: wallets
      .filter((entry) => entry.wallet_kind === 'evm')
      .map((entry) => entry.wallet),
    solana_wallets: wallets
      .filter((entry) => entry.wallet_kind === 'solana')
      .map((entry) => entry.wallet),
    x_username: farcaster?.username ?? null,
    farcaster,
  }
}

export async function getTokenSummary(tokenAddress: string): Promise<{
  address: string
  name: string | null
  symbol: string | null
  total_supply: number | null
  holder_count: number
} | null> {
  const rows = await db<
    Array<{ token_address: string; name: string | null; symbol: string | null; total_supply: string | null; holder_count: number }>
  >`
    SELECT token_address, name, symbol, total_supply::text AS total_supply, holder_count
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    WHERE token_address = ${tokenAddress}
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  return {
    address: row.token_address,
    name: row.name,
    symbol: row.symbol,
    total_supply: row.total_supply === null ? null : Number(row.total_supply),
    holder_count: row.holder_count,
  }
}

export async function getTransferTimeline(tokenAddress: string): Promise<unknown | null> {
  await ensureTimelineColumn()

  const rows = await db<{ transfer_timeline: unknown | null }[]>`
    SELECT transfer_timeline
    FROM ${db(CONFIG.SCHEMA)}.token_registry
    WHERE token_address = ${tokenAddress}
    LIMIT 1
  `
  return rows[0]?.transfer_timeline ?? null
}

export function parseTokenBreakdown(value: unknown): Array<{ token: string; token_name: string; heat_degrees: number }> {
  return parseJsonArray<{ token: string; token_name: string; heat_degrees: number }>(value)
}

export function parseWallets(value: unknown): string[] {
  return parseJsonArray<string>(value)
}

export async function updateBungalowMetadata(
  tokenAddress: string,
  data: DexScreenerData,
): Promise<void> {
  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.bungalows
    SET
      image_url = COALESCE(image_url, ${data.imageUrl}),
      price_usd = ${data.priceUsd},
      market_cap = ${data.marketCap},
      volume_24h = ${data.volume24h},
      liquidity_usd = ${data.liquidityUsd},
      link_website = COALESCE(link_website, ${data.linkWebsite}),
      link_x = COALESCE(link_x, ${data.linkX}),
      link_telegram = COALESCE(link_telegram, ${data.linkTelegram}),
      link_dexscreener = COALESCE(link_dexscreener, ${data.linkDexscreener}),
      metadata_updated_at = NOW()
    WHERE token_address = ${tokenAddress}
  `
}

export async function getBulletinPosts(
  tokenAddress: string,
  limit: number,
  offset: number,
): Promise<{ posts: (BulletinPostRow & { poster_username: string | null; poster_pfp: string | null })[]; total: number }> {
  const posts = await db<(BulletinPostRow & { poster_username: string | null; poster_pfp: string | null })[]>`
    SELECT bp.id, bp.token_address, bp.chain, bp.wallet, bp.content, bp.image_url,
           bp.created_at::text AS created_at,
           wfp.username AS poster_username,
           wfp.pfp_url AS poster_pfp
    FROM ${db(CONFIG.SCHEMA)}.bulletin_posts bp
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = bp.wallet
    WHERE bp.token_address = ${tokenAddress}
    ORDER BY bp.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  const totalRows = await db<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${db(CONFIG.SCHEMA)}.bulletin_posts
    WHERE token_address = ${tokenAddress}
  `

  return {
    posts,
    total: Number(totalRows[0]?.cnt ?? 0),
  }
}

export async function createBulletinPost(input: {
  tokenAddress: string
  chain: string
  wallet: string
  content: string
  imageUrl: string | null
}): Promise<BulletinPostRow> {
  const rows = await db<BulletinPostRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bulletin_posts (
      token_address, chain, wallet, content, image_url
    )
    VALUES (
      ${input.tokenAddress}, ${input.chain}, ${input.wallet}, ${input.content}, ${input.imageUrl}
    )
    RETURNING id, token_address, chain, wallet, content, image_url, created_at::text AS created_at
  `
  return rows[0]
}

export interface GlobalFeedPost {
  id: number
  wallet: string
  content: string
  image_url: string | null
  created_at: string
  token_address: string
  chain: string
  token_name: string | null
  token_symbol: string | null
  bungalow_image_url: string | null
  poster_username: string | null
  poster_pfp: string | null
}

export async function getGlobalBulletinFeed(
  limit: number,
  offset: number,
): Promise<{ posts: GlobalFeedPost[]; total: number }> {
  const posts = await db<GlobalFeedPost[]>`
    SELECT bp.id, bp.wallet, bp.content, bp.image_url,
           bp.created_at::text AS created_at,
           bp.token_address, bp.chain,
           b.name AS token_name,
           b.symbol AS token_symbol,
           b.image_url AS bungalow_image_url,
           wfp.username AS poster_username,
           wfp.pfp_url AS poster_pfp
    FROM ${db(CONFIG.SCHEMA)}.bulletin_posts bp
    LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalows b
      ON b.token_address = bp.token_address
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = bp.wallet
    ORDER BY bp.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  const totalRows = await db<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${db(CONFIG.SCHEMA)}.bulletin_posts
  `

  return {
    posts,
    total: Number(totalRows[0]?.cnt ?? 0),
  }
}

let sceneAssetTablesPromise: Promise<void> | null = null

async function ensureSceneAssetTables(): Promise<void> {
  if (!sceneAssetTablesPromise) {
    sceneAssetTablesPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_scenes (
          id BIGSERIAL PRIMARY KEY,
          chain TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          scene_config JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT,
          UNIQUE(chain, contract_address)
        )
      `

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.asset_catalog (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          category TEXT NOT NULL,
          price_jbm NUMERIC NOT NULL DEFAULT 0,
          thumbnail_url TEXT NOT NULL,
          model_url TEXT,
          description TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `

      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.asset_purchases (
          id BIGSERIAL PRIMARY KEY,
          chain TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          slot_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          wallet TEXT NOT NULL,
          tx_hash TEXT,
          purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    })()
  }

  await sceneAssetTablesPromise
}

export async function updateBungalowCuration(
  tokenAddress: string,
  chain: string,
  fields: {
    description?: string | null
    origin_story?: string | null
    link_x?: string | null
    link_farcaster?: string | null
    link_telegram?: string | null
    link_website?: string | null
  },
): Promise<void> {
  const hasDesc = fields.description !== undefined
  const hasStory = fields.origin_story !== undefined
  const hasLinkX = fields.link_x !== undefined
  const hasLinkFc = fields.link_farcaster !== undefined
  const hasLinkTg = fields.link_telegram !== undefined
  const hasLinkWeb = fields.link_website !== undefined

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.bungalows
    SET
      description = CASE WHEN ${hasDesc} THEN ${fields.description ?? null} ELSE description END,
      origin_story = CASE WHEN ${hasStory} THEN ${fields.origin_story ?? null} ELSE origin_story END,
      link_x = CASE WHEN ${hasLinkX} THEN ${fields.link_x ?? null} ELSE link_x END,
      link_farcaster = CASE WHEN ${hasLinkFc} THEN ${fields.link_farcaster ?? null} ELSE link_farcaster END,
      link_telegram = CASE WHEN ${hasLinkTg} THEN ${fields.link_telegram ?? null} ELSE link_telegram END,
      link_website = CASE WHEN ${hasLinkWeb} THEN ${fields.link_website ?? null} ELSE link_website END,
      updated_at = NOW()
    WHERE token_address = ${tokenAddress} AND chain = ${chain}
  `
}

export async function getBungalowOwnerRecord(tokenAddress: string, chain: string): Promise<{
  current_owner: string | null
  verified_admin: string | null
} | null> {
  const rows = await db<Array<{ current_owner: string | null; verified_admin: string | null }>>`
    SELECT current_owner, verified_admin
    FROM ${db(CONFIG.SCHEMA)}.bungalows
    WHERE token_address = ${tokenAddress} AND chain = ${chain}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function upsertClaimedBungalow(input: {
  tokenAddress: string
  chain: string
  owner: string
  name?: string
  symbol?: string
}): Promise<void> {
  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
      token_address,
      chain,
      name,
      symbol,
      current_owner,
      is_claimed,
      updated_at
    )
    VALUES (
      ${input.tokenAddress},
      ${input.chain},
      ${input.name ?? null},
      ${input.symbol ?? null},
      ${input.owner},
      TRUE,
      NOW()
    )
    ON CONFLICT (token_address)
    DO UPDATE SET
      chain = EXCLUDED.chain,
      name = COALESCE(EXCLUDED.name, ${db(CONFIG.SCHEMA)}.bungalows.name),
      symbol = COALESCE(EXCLUDED.symbol, ${db(CONFIG.SCHEMA)}.bungalows.symbol),
      current_owner = EXCLUDED.current_owner,
      is_claimed = TRUE,
      updated_at = NOW()
  `
}

export async function getBungalowSceneConfig(
  chain: string,
  contractAddress: string,
): Promise<BungalowSceneRow | null> {
  await ensureSceneAssetTables()

  const rows = await db<BungalowSceneRow[]>`
    SELECT
      id,
      chain,
      contract_address,
      scene_config,
      updated_at::text AS updated_at,
      updated_by
    FROM ${db(CONFIG.SCHEMA)}.bungalow_scenes
    WHERE chain = ${chain} AND contract_address = ${contractAddress}
    LIMIT 1
  `

  return rows[0] ?? null
}

export async function upsertBungalowSceneConfig(input: {
  chain: string
  contractAddress: string
  sceneConfig: unknown
  updatedBy: string
}): Promise<BungalowSceneRow> {
  await ensureSceneAssetTables()

  const rows = await db<BungalowSceneRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_scenes (
      chain,
      contract_address,
      scene_config,
      updated_by
    )
    VALUES (
      ${input.chain},
      ${input.contractAddress},
      ${JSON.stringify(input.sceneConfig)}::jsonb,
      ${input.updatedBy}
    )
    ON CONFLICT (chain, contract_address)
    DO UPDATE SET
      scene_config = EXCLUDED.scene_config,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
    RETURNING
      id,
      chain,
      contract_address,
      scene_config,
      updated_at::text AS updated_at,
      updated_by
  `

  return rows[0]
}

export async function createAssetPurchase(input: {
  chain: string
  contractAddress: string
  slotId: string
  assetId: string
  wallet: string
  txHash?: string
}): Promise<AssetPurchaseRow> {
  await ensureSceneAssetTables()

  const rows = await db<AssetPurchaseRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.asset_purchases (
      chain,
      contract_address,
      slot_id,
      asset_id,
      wallet,
      tx_hash
    )
    VALUES (
      ${input.chain},
      ${input.contractAddress},
      ${input.slotId},
      ${input.assetId},
      ${input.wallet},
      ${input.txHash ?? null}
    )
    RETURNING
      id::text AS id,
      chain,
      contract_address,
      slot_id,
      asset_id,
      wallet,
      tx_hash,
      purchased_at::text AS purchased_at
  `

  return rows[0]
}

let widgetTablesPromise: Promise<void> | null = null

async function ensureWidgetTables(): Promise<void> {
  if (!widgetTablesPromise) {
    widgetTablesPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.bungalow_widget_installs (
          id BIGSERIAL PRIMARY KEY,
          chain TEXT NOT NULL,
          token_address TEXT NOT NULL,
          widget_id TEXT NOT NULL,
          package_name TEXT NOT NULL,
          version TEXT NOT NULL,
          repo_url TEXT,
          installed_by TEXT NOT NULL,
          installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(chain, token_address, widget_id)
        )
      `

      await db`
        CREATE INDEX IF NOT EXISTS idx_widget_installs_bungalow
        ON ${db(CONFIG.SCHEMA)}.bungalow_widget_installs (chain, token_address, installed_at DESC)
      `
    })()
  }

  await widgetTablesPromise
}

export async function getInstalledWidgets(
  chain: string,
  tokenAddress: string,
): Promise<BungalowWidgetInstallRow[]> {
  await ensureWidgetTables()

  return db<BungalowWidgetInstallRow[]>`
    SELECT
      id::text AS id,
      chain,
      token_address,
      widget_id,
      package_name,
      version,
      repo_url,
      installed_by,
      installed_at::text AS installed_at
    FROM ${db(CONFIG.SCHEMA)}.bungalow_widget_installs
    WHERE chain = ${chain}
      AND token_address = ${tokenAddress}
    ORDER BY installed_at DESC
  `
}

export async function installWidget(input: {
  chain: string
  tokenAddress: string
  widgetId: string
  packageName: string
  version: string
  repoUrl?: string | null
  installedBy: string
}): Promise<BungalowWidgetInstallRow> {
  await ensureWidgetTables()

  const rows = await db<BungalowWidgetInstallRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalow_widget_installs (
      chain,
      token_address,
      widget_id,
      package_name,
      version,
      repo_url,
      installed_by
    )
    VALUES (
      ${input.chain},
      ${input.tokenAddress},
      ${input.widgetId},
      ${input.packageName},
      ${input.version},
      ${input.repoUrl ?? null},
      ${input.installedBy}
    )
    ON CONFLICT (chain, token_address, widget_id)
    DO UPDATE SET
      package_name = EXCLUDED.package_name,
      version = EXCLUDED.version,
      repo_url = EXCLUDED.repo_url,
      installed_by = EXCLUDED.installed_by,
      installed_at = NOW()
    RETURNING
      id::text AS id,
      chain,
      token_address,
      widget_id,
      package_name,
      version,
      repo_url,
      installed_by,
      installed_at::text AS installed_at
  `

  return rows[0]
}

// ─── Agent Keys ───────────────────────────────────────────────

let agentTablePromise: Promise<void> | null = null

async function ensureAgentTable(): Promise<void> {
  if (!agentTablePromise) {
    agentTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.agent_keys (
          id BIGSERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL UNIQUE,
          api_key_hash TEXT NOT NULL,
          description TEXT,
          wallet TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ
        )
      `
    })()
  }
  await agentTablePromise
}

export interface AgentRow {
  id: number
  agent_name: string
  api_key_hash: string
  description: string | null
  wallet: string | null
  created_at: string
  last_used_at: string | null
}

export async function createAgent(input: {
  agentName: string
  apiKeyHash: string
  description?: string
  wallet?: string
}): Promise<AgentRow> {
  await ensureAgentTable()

  const rows = await db<AgentRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.agent_keys (
      agent_name, api_key_hash, description, wallet
    )
    VALUES (
      ${input.agentName},
      ${input.apiKeyHash},
      ${input.description ?? null},
      ${input.wallet ?? null}
    )
    RETURNING id, agent_name, api_key_hash, description, wallet,
              created_at::text AS created_at, last_used_at::text AS last_used_at
  `
  return rows[0]
}

export async function getAgentByName(agentName: string): Promise<AgentRow | null> {
  await ensureAgentTable()

  const rows = await db<AgentRow[]>`
    SELECT id, agent_name, api_key_hash, description, wallet,
           created_at::text AS created_at, last_used_at::text AS last_used_at
    FROM ${db(CONFIG.SCHEMA)}.agent_keys
    WHERE agent_name = ${agentName}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function getAgentByKeyHash(apiKeyHash: string): Promise<AgentRow | null> {
  await ensureAgentTable()

  const rows = await db<AgentRow[]>`
    SELECT id, agent_name, api_key_hash, description, wallet,
           created_at::text AS created_at, last_used_at::text AS last_used_at
    FROM ${db(CONFIG.SCHEMA)}.agent_keys
    WHERE api_key_hash = ${apiKeyHash}
    LIMIT 1
  `
  if (!rows[0]) return null

  // Touch last_used_at
  void db`
    UPDATE ${db(CONFIG.SCHEMA)}.agent_keys
    SET last_used_at = NOW()
    WHERE id = ${rows[0].id}
  `

  return rows[0]
}

export interface ActivityEvent {
  type: 'post' | 'scan'
  timestamp: string
  chain: string
  token_address: string
  token_name: string | null
  username: string | null
  detail: string | null
}

export async function getRecentActivity(limit: number = 20): Promise<ActivityEvent[]> {
  const rows = await db<ActivityEvent[]>`
    (
      SELECT
        'post' AS type,
        bp.created_at::text AS timestamp,
        bp.chain,
        bp.token_address,
        b.name AS token_name,
        wfp.username,
        LEFT(bp.content, 80) AS detail
      FROM ${db(CONFIG.SCHEMA)}.bulletin_posts bp
      LEFT JOIN ${db(CONFIG.SCHEMA)}.bungalows b ON b.token_address = bp.token_address
      LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp ON wfp.wallet = bp.wallet
      ORDER BY bp.created_at DESC
      LIMIT ${limit}
    )
    UNION ALL
    (
      SELECT
        'scan' AS type,
        sl.completed_at::text AS timestamp,
        sl.chain,
        sl.token_address,
        tr.name AS token_name,
        NULL AS username,
        sl.holders_found::text AS detail
      FROM ${db(CONFIG.SCHEMA)}.scan_log sl
      LEFT JOIN ${db(CONFIG.SCHEMA)}.token_registry tr ON tr.token_address = sl.token_address
      WHERE sl.scan_status = 'complete' AND sl.completed_at IS NOT NULL
      ORDER BY sl.completed_at DESC
      LIMIT ${limit}
    )
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `
  return rows
}

export async function getCustomBungalow(tokenAddress: string, chain: string): Promise<{ html: string } | null> {
  const rows = await db<{ html: string }[]>`
    SELECT html FROM ${db(CONFIG.SCHEMA)}.custom_bungalows
    WHERE token_address = ${tokenAddress} AND chain = ${chain} AND is_active = TRUE
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function updateAgentProfile(agentName: string, fields: {
  description?: string | null
  wallet?: string | null
}): Promise<void> {
  await ensureAgentTable()

  const hasDesc = fields.description !== undefined
  const hasWallet = fields.wallet !== undefined

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.agent_keys
    SET
      description = CASE WHEN ${hasDesc} THEN ${fields.description ?? null} ELSE description END,
      wallet = CASE WHEN ${hasWallet} THEN ${fields.wallet ?? null} ELSE wallet END
    WHERE agent_name = ${agentName}
  `
}

// ═══ BODEGA ═══

export interface BodegaCatalogFilters {
  asset_type?: BodegaCatalogRow['asset_type']
  creator_wallet?: string
  active?: boolean
}

export interface BodegaInstallWithCatalogRow extends BodegaInstallRow {
  catalog_item: BodegaCatalogRow
}

/**
 * Builds a safe WHERE clause for catalog filters so the Bodega can paginate flexibly.
 */
function buildBodegaCatalogWhereClause(
  filters?: BodegaCatalogFilters,
): { clause: string; params: Array<string | boolean> } {
  const clauses: string[] = []
  const params: Array<string | boolean> = []

  if (filters?.asset_type) {
    params.push(filters.asset_type)
    clauses.push(`bc.asset_type = $${params.length}`)
  }

  if (filters?.creator_wallet) {
    params.push(filters.creator_wallet)
    clauses.push(`bc.creator_wallet = $${params.length}`)
  }

  if (typeof filters?.active === 'boolean') {
    params.push(filters.active)
    clauses.push(`bc.active = $${params.length}`)
  }

  return {
    clause: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE',
    params,
  }
}

/**
 * Creates a catalog listing so Bodega assets can exist independently of one bungalow install.
 */
export async function createCatalogItem(data: {
  creator_wallet: string
  creator_handle?: string | null
  origin_bungalow_token_address?: string | null
  origin_bungalow_chain?: string | null
  asset_type: BodegaCatalogRow['asset_type']
  title: string
  description?: string | null
  content: unknown
  preview_url?: string | null
  price_in_jbm: string
}): Promise<BodegaCatalogRow> {
  const rows = await db<BodegaCatalogRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bodega_catalog (
      creator_wallet,
      creator_handle,
      origin_bungalow_token_address,
      origin_bungalow_chain,
      asset_type,
      title,
      description,
      content,
      preview_url,
      price_in_jbm
    )
    VALUES (
      ${data.creator_wallet},
      ${data.creator_handle ?? null},
      ${data.origin_bungalow_token_address ?? null},
      ${data.origin_bungalow_chain ?? null},
      ${data.asset_type},
      ${data.title},
      ${data.description ?? null},
      ${JSON.stringify(data.content)}::jsonb,
      ${data.preview_url ?? null},
      ${data.price_in_jbm}
    )
    RETURNING
      id,
      creator_wallet,
      creator_handle,
      origin_bungalow_token_address,
      origin_bungalow_chain,
      asset_type,
      title,
      description,
      content,
      preview_url,
      price_in_jbm::text AS price_in_jbm,
      install_count,
      active,
      created_at::text AS created_at
  `

  return rows[0]
}

/**
 * Reads one catalog listing so install and detail routes can validate against stored inventory.
 */
export async function getCatalogItem(id: number): Promise<BodegaCatalogRow | null> {
  const rows = await db<BodegaCatalogRow[]>`
    SELECT
      id,
      creator_wallet,
      creator_handle,
      origin_bungalow_token_address,
      origin_bungalow_chain,
      asset_type,
      title,
      description,
      content,
      preview_url,
      price_in_jbm::text AS price_in_jbm,
      install_count,
      active,
      created_at::text AS created_at
    FROM ${db(CONFIG.SCHEMA)}.bodega_catalog
    WHERE id = ${id}
    LIMIT 1
  `

  return rows[0] ?? null
}

/**
 * Lists catalog items with optional filtering so the Bodega storefront can paginate cheaply.
 */
export async function getCatalogItems(
  filters?: BodegaCatalogFilters,
  limit = 20,
  offset = 0,
): Promise<BodegaCatalogRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100))
  const safeOffset = Math.max(offset, 0)
  const where = buildBodegaCatalogWhereClause(filters)
  const limitParam = where.params.length + 1
  const offsetParam = where.params.length + 2

  return db.unsafe<BodegaCatalogRow[]>(
    `SELECT
      bc.id,
      bc.creator_wallet,
      bc.creator_handle,
      bc.origin_bungalow_token_address,
      bc.origin_bungalow_chain,
      bc.asset_type,
      bc.title,
      bc.description,
      bc.content,
      bc.preview_url,
      bc.price_in_jbm::text AS price_in_jbm,
      bc.install_count,
      bc.active,
      bc.created_at::text AS created_at
    FROM "${CONFIG.SCHEMA}".bodega_catalog bc
    WHERE ${where.clause}
    ORDER BY bc.created_at DESC, bc.id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}`,
    [...where.params, safeLimit, safeOffset],
  )
}

/**
 * Lists all catalog items by a creator so profile surfaces can show their published work.
 */
export async function getCatalogItemsByCreator(wallet: string): Promise<BodegaCatalogRow[]> {
  return getCatalogItems({ creator_wallet: wallet }, 100, 0)
}

/**
 * Increments install_count so the catalog reflects demand without recalculating on every read.
 */
export async function incrementInstallCount(catalog_item_id: number): Promise<void> {
  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.bodega_catalog
    SET install_count = install_count + 1
    WHERE id = ${catalog_item_id}
  `
}

/**
 * Deactivates a creator-owned listing so delisted assets stop appearing in the public catalog.
 */
export async function deactivateCatalogItem(
  id: number,
  requesting_wallet: string,
): Promise<BodegaCatalogRow | null> {
  const rows = await db<BodegaCatalogRow[]>`
    UPDATE ${db(CONFIG.SCHEMA)}.bodega_catalog
    SET active = FALSE
    WHERE id = ${id}
      AND creator_wallet = ${requesting_wallet}
    RETURNING
      id,
      creator_wallet,
      creator_handle,
      origin_bungalow_token_address,
      origin_bungalow_chain,
      asset_type,
      title,
      description,
      content,
      preview_url,
      price_in_jbm::text AS price_in_jbm,
      install_count,
      active,
      created_at::text AS created_at
  `

  return rows[0] ?? null
}

/**
 * Writes a Bodega install and calculates the creator credit at insert time.
 */
export async function createBodegaInstall(data: {
  catalog_item_id: number
  installed_to_token_address: string
  installed_to_chain: string
  installed_by_wallet: string
  tx_hash: string
  jbm_amount: string
}): Promise<BodegaInstallRow> {
  const rows = await db<BodegaInstallRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bodega_installs (
      catalog_item_id,
      installed_to_token_address,
      installed_to_chain,
      installed_by_wallet,
      tx_hash,
      jbm_amount,
      creator_credit_jbm
    )
    VALUES (
      ${data.catalog_item_id},
      ${data.installed_to_token_address},
      ${data.installed_to_chain},
      ${data.installed_by_wallet},
      ${data.tx_hash},
      ${data.jbm_amount},
      (${data.jbm_amount}::numeric * 30 / 100)
    )
    RETURNING
      id,
      catalog_item_id,
      installed_to_token_address,
      installed_to_chain,
      installed_by_wallet,
      tx_hash,
      jbm_amount::text AS jbm_amount,
      creator_credit_jbm::text AS creator_credit_jbm,
      credit_claimed,
      created_at::text AS created_at
  `

  return rows[0]
}

/**
 * Lists installs for one bungalow with embedded catalog metadata for the bungalow page.
 */
export async function getBodegaInstallsByBungalow(
  token_address: string,
  chain: string,
): Promise<BodegaInstallWithCatalogRow[]> {
  const rows = await db<Array<BodegaInstallRow & { catalog_item: unknown }>>`
    SELECT
      bi.id,
      bi.catalog_item_id,
      bi.installed_to_token_address,
      bi.installed_to_chain,
      bi.installed_by_wallet,
      bi.tx_hash,
      bi.jbm_amount::text AS jbm_amount,
      bi.creator_credit_jbm::text AS creator_credit_jbm,
      bi.credit_claimed,
      bi.created_at::text AS created_at,
      jsonb_build_object(
        'id', bc.id,
        'creator_wallet', bc.creator_wallet,
        'creator_handle', bc.creator_handle,
        'origin_bungalow_token_address', bc.origin_bungalow_token_address,
        'origin_bungalow_chain', bc.origin_bungalow_chain,
        'asset_type', bc.asset_type,
        'title', bc.title,
        'description', bc.description,
        'content', bc.content,
        'preview_url', bc.preview_url,
        'price_in_jbm', bc.price_in_jbm::text,
        'install_count', bc.install_count,
        'active', bc.active,
        'created_at', bc.created_at::text
      ) AS catalog_item
    FROM ${db(CONFIG.SCHEMA)}.bodega_installs bi
    INNER JOIN ${db(CONFIG.SCHEMA)}.bodega_catalog bc
      ON bc.id = bi.catalog_item_id
    WHERE bi.installed_to_token_address = ${token_address}
      AND bi.installed_to_chain = ${chain}
    ORDER BY bi.created_at DESC, bi.id DESC
  `

  return rows.map((row) => ({
    ...row,
    catalog_item: row.catalog_item as BodegaCatalogRow,
  }))
}

/**
 * Summarizes unpaid creator credits from raw installs so the rewards inbox can show Bodega revenue.
 */
export async function getUnclaimedCreatorCredits(
  creator_wallet: string,
): Promise<{ total_jbm: number; installs: BodegaInstallWithCatalogRow[] }> {
  const installs = await db<Array<BodegaInstallRow & { catalog_item: unknown }>>`
    SELECT
      bi.id,
      bi.catalog_item_id,
      bi.installed_to_token_address,
      bi.installed_to_chain,
      bi.installed_by_wallet,
      bi.tx_hash,
      bi.jbm_amount::text AS jbm_amount,
      bi.creator_credit_jbm::text AS creator_credit_jbm,
      bi.credit_claimed,
      bi.created_at::text AS created_at,
      jsonb_build_object(
        'id', bc.id,
        'creator_wallet', bc.creator_wallet,
        'creator_handle', bc.creator_handle,
        'origin_bungalow_token_address', bc.origin_bungalow_token_address,
        'origin_bungalow_chain', bc.origin_bungalow_chain,
        'asset_type', bc.asset_type,
        'title', bc.title,
        'description', bc.description,
        'content', bc.content,
        'preview_url', bc.preview_url,
        'price_in_jbm', bc.price_in_jbm::text,
        'install_count', bc.install_count,
        'active', bc.active,
        'created_at', bc.created_at::text
      ) AS catalog_item
    FROM ${db(CONFIG.SCHEMA)}.bodega_installs bi
    INNER JOIN ${db(CONFIG.SCHEMA)}.bodega_catalog bc
      ON bc.id = bi.catalog_item_id
    WHERE bc.creator_wallet = ${creator_wallet}
      AND bi.credit_claimed = FALSE
    ORDER BY bi.created_at DESC, bi.id DESC
  `

  const totalRows = await db<Array<{ total_jbm: string | null }>>`
    SELECT COALESCE(SUM(bi.creator_credit_jbm), 0)::text AS total_jbm
    FROM ${db(CONFIG.SCHEMA)}.bodega_installs bi
    INNER JOIN ${db(CONFIG.SCHEMA)}.bodega_catalog bc
      ON bc.id = bi.catalog_item_id
    WHERE bc.creator_wallet = ${creator_wallet}
      AND bi.credit_claimed = FALSE
  `

  return {
    total_jbm: Number(totalRows[0]?.total_jbm ?? 0),
    installs: installs.map((row) => ({
      ...row,
      catalog_item: row.catalog_item as BodegaCatalogRow,
    })),
  }
}

/**
 * Marks installs as claimed after the creator payout has been reconciled.
 */
export async function markCreditsAsClaimed(install_ids: number[]): Promise<void> {
  if (install_ids.length === 0) return

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.bodega_installs
    SET credit_claimed = TRUE
    WHERE id IN ${db(install_ids)}
  `
}

/**
 * Records a bonus heat event so engagement bonuses live in their own additive ledger.
 */
export async function createBonusHeatEvent(data: {
  wallet: string
  token_address: string
  chain: string
  event_type: BonusHeatEventRow['event_type']
  bonus_points: number
}): Promise<BonusHeatEventRow> {
  const rows = await db<BonusHeatEventRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bonus_heat_events (
      wallet,
      token_address,
      chain,
      event_type,
      bonus_points
    )
    VALUES (
      ${data.wallet},
      ${data.token_address},
      ${data.chain},
      ${data.event_type},
      ${data.bonus_points}
    )
    RETURNING
      id,
      wallet,
      token_address,
      chain,
      event_type,
      bonus_points,
      created_at::text AS created_at
  `

  return rows[0]
}

/**
 * Sums additive bonus heat for one wallet and bungalow deployment.
 */
export async function getBonusHeatPoints(
  wallet: string,
  token_address: string,
  chain: string,
): Promise<number> {
  const rows = await db<Array<{ total_points: string | null }>>`
    SELECT COALESCE(SUM(bonus_points), 0)::text AS total_points
    FROM ${db(CONFIG.SCHEMA)}.bonus_heat_events
    WHERE wallet = ${wallet}
      AND token_address = ${token_address}
      AND chain = ${chain}
  `

  return Number(rows[0]?.total_points ?? 0)
}

/**
 * Creates or refreshes a manual signature-backed wallet link without changing older auto-discovery flows.
 */
export async function linkWallet(
  primary_wallet: string,
  linked_wallet: string,
  signature: string,
  message: string,
): Promise<UserWalletLinkRow> {
  await ensureUserWalletLinksTable()

  const existing = await db<UserWalletLinkRow[]>`
    SELECT
      id,
      primary_wallet,
      linked_wallet,
      verification_signature,
      verification_message,
      created_at::text AS created_at
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE primary_wallet = ${primary_wallet}
      AND linked_wallet = ${linked_wallet}
    LIMIT 1
  `

  if (existing.length > 0) {
    const rows = await db<UserWalletLinkRow[]>`
      UPDATE ${db(CONFIG.SCHEMA)}.user_wallet_links
      SET
        verification_signature = ${signature},
        verification_message = ${message},
        created_at = NOW()
      WHERE primary_wallet = ${primary_wallet}
        AND linked_wallet = ${linked_wallet}
      RETURNING
        id,
        primary_wallet,
        linked_wallet,
        verification_signature,
        verification_message,
        created_at::text AS created_at
    `

    return rows[0]
  }

  const rows = await db<UserWalletLinkRow[]>`
    INSERT INTO ${db(CONFIG.SCHEMA)}.user_wallet_links (
      primary_wallet,
      linked_wallet,
      verification_signature,
      verification_message
    )
    VALUES (
      ${primary_wallet},
      ${linked_wallet},
      ${signature},
      ${message}
    )
    RETURNING
      id,
      primary_wallet,
      linked_wallet,
      verification_signature,
      verification_message,
      created_at::text AS created_at
  `

  return rows[0]
}

/**
 * Lists every manual link under a primary wallet so account settings can render the current link set.
 */
export async function getLinkedWallets(primary_wallet: string): Promise<UserWalletLinkRow[]> {
  await ensureUserWalletLinksTable()

  return db<UserWalletLinkRow[]>`
    SELECT
      id,
      primary_wallet,
      linked_wallet,
      verification_signature,
      verification_message,
      created_at::text AS created_at
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE primary_wallet = ${primary_wallet}
    ORDER BY created_at ASC, id ASC
  `
}

/**
 * Finds one primary wallet for a linked wallet so legacy callers can still resolve a simple anchor.
 */
export async function getPrimaryWalletForLinked(linked_wallet: string): Promise<string | null> {
  await ensureUserWalletLinksTable()

  const rows = await db<Array<{ primary_wallet: string }>>`
    SELECT primary_wallet
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE linked_wallet = ${linked_wallet}
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `

  return rows[0]?.primary_wallet ?? null
}

/**
 * Removes a manual wallet link so users can revoke read-only linked identities.
 */
export async function unlinkWallet(
  primary_wallet: string,
  linked_wallet: string,
): Promise<void> {
  await ensureUserWalletLinksTable()

  await db`
    DELETE FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE primary_wallet = ${primary_wallet}
      AND linked_wallet = ${linked_wallet}
  `
}
