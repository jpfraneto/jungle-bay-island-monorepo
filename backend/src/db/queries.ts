import { CONFIG, db, normalizeAddress } from '../config'
import { addHeatToDistribution, emptyTierDistribution, getTierFromHeat } from '../services/heat'
import type { ScanResult } from '../services/scanner'
import type {
  AssetPurchaseRow,
  BungalowSceneRow,
  BungalowWidgetInstallRow,
  BulletinPostRow,
  BungalowRow,
  FidIslandProfileRow,
  ScanLogRow,
  TokenHolderRow,
  TokenRegistryRow,
} from './schema'
import type { DexScreenerData } from '../services/dexscreener'

const SCHEMA = `"${CONFIG.SCHEMA}"`

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

export async function getTokenHolders(
  tokenAddress: string,
  limit: number,
  offset: number,
): Promise<{ holders: TokenHolderRow[]; total: number }> {
  const holders = await db<TokenHolderRow[]>`
    SELECT
      thh.wallet,
      thh.heat_degrees,
      wfp.island_heat,
      wfp.fid,
      wfp.username,
      wfp.pfp_url
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat thh
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = thh.wallet
    WHERE thh.token_address = ${tokenAddress}
    ORDER BY thh.heat_degrees DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  const totalRows = await db<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${tokenAddress}
  `

  return {
    holders,
    total: Number(totalRows[0]?.cnt ?? 0),
  }
}

export async function getTokenHeatDistribution(tokenAddress: string) {
  const rows = await db<{ island_heat: string | null }[]>`
    SELECT wfp.island_heat
    FROM ${db(CONFIG.SCHEMA)}.token_holder_heat thh
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON wfp.wallet = thh.wallet
    WHERE thh.token_address = ${tokenAddress}
  `

  const distribution = emptyTierDistribution()
  for (const row of rows) {
    addHeatToDistribution(distribution, Number(row.island_heat ?? 0))
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
  progress: { phase: string; pct: number },
): Promise<void> {
  await ensureScanLogProgressColumns()

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.scan_log
    SET
      progress_phase = ${progress.phase},
      progress_pct = ${Math.max(0, Math.min(100, progress.pct))},
      completed_at = CASE WHEN ${progress.pct >= 100} THEN NOW() ELSE completed_at END
    WHERE id = ${scanId}
  `
}

export async function writeScanResult(scanId: number, result: ScanResult): Promise<void> {
  await ensureScanLogProgressColumns()

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.token_registry (
      token_address, chain, name, symbol, decimals, total_supply,
      deploy_block, deploy_timestamp, scan_status, last_scanned_at,
      last_scan_block, holder_count
    )
    VALUES (
      ${result.tokenAddress}, ${result.chain}, ${result.name}, ${result.symbol}, ${result.decimals},
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

  await db`
    DELETE FROM ${db(CONFIG.SCHEMA)}.token_holder_heat
    WHERE token_address = ${result.tokenAddress}
  `

  const holderRows = result.holders.map((holder) => ({
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

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
      token_address, chain, name, symbol, holder_count, total_supply, updated_at
    )
    VALUES (
      ${result.tokenAddress}, ${result.chain}, ${result.name}, ${result.symbol}, ${result.holderCount}, ${result.totalSupply}, NOW()
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
    is_claimed: boolean
    scan_status: string
  }>>`
    SELECT
      tr.chain,
      tr.token_address,
      COALESCE(b.name, tr.name) AS name,
      COALESCE(b.symbol, tr.symbol) AS symbol,
      tr.holder_count,
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
  token_breakdown: Array<{ token: string; token_name: string; heat_degrees: number }>
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

  const tokenRows = await db<Array<{ token: string; token_name: string | null; heat_degrees: string }>>`
    SELECT
      thh.token_address AS token,
      tr.name AS token_name,
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

  const islandHeat = Number(profile?.island_heat ?? 0)
  const tier = profile?.tier ?? getTierFromHeat(islandHeat)

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
    token_breakdown: tokenRows.map((row) => ({
      token: row.token,
      token_name: row.token_name ?? row.token,
      heat_degrees: Number(row.heat_degrees),
    })),
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
          wallet TEXT NOT NULL,
          wallet_kind TEXT NOT NULL,
          privy_user_id TEXT,
          fid BIGINT,
          x_username TEXT,
          seen_via_privy BOOLEAN NOT NULL DEFAULT FALSE,
          seen_via_farcaster BOOLEAN NOT NULL DEFAULT FALSE,
          farcaster_verified BOOLEAN NOT NULL DEFAULT FALSE,
          last_seen_requester_wallet BOOLEAN NOT NULL DEFAULT FALSE,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (wallet, wallet_kind),
          CHECK (wallet_kind IN ('evm', 'solana'))
        )
      `

      await db`
        CREATE INDEX IF NOT EXISTS idx_user_wallet_links_privy
        ON ${db(CONFIG.SCHEMA)}.user_wallet_links (privy_user_id, last_seen_at DESC)
      `

      await db`
        CREATE INDEX IF NOT EXISTS idx_user_wallet_links_fid
        ON ${db(CONFIG.SCHEMA)}.user_wallet_links (fid, last_seen_at DESC)
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

export async function upsertUserWalletLinks(input: {
  privyUserId: string | null
  fid: number | null
  xUsername: string | null
  rows: UserWalletLinkUpsertRow[]
}): Promise<void> {
  await ensureUserWalletLinksTable()

  if (input.rows.length === 0) return

  const rows = input.rows.map((row) => ({
    wallet: row.wallet,
    wallet_kind: row.wallet_kind,
    privy_user_id: input.privyUserId,
    fid: input.fid,
    x_username: input.xUsername,
    seen_via_privy: row.seen_via_privy,
    seen_via_farcaster: row.seen_via_farcaster,
    farcaster_verified: row.farcaster_verified,
    last_seen_requester_wallet: row.last_seen_requester_wallet,
  }))

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.user_wallet_links
      ${db(
        rows,
        'wallet',
        'wallet_kind',
        'privy_user_id',
        'fid',
        'x_username',
        'seen_via_privy',
        'seen_via_farcaster',
        'farcaster_verified',
        'last_seen_requester_wallet',
      )}
    ON CONFLICT (wallet, wallet_kind) DO UPDATE SET
      privy_user_id = COALESCE(EXCLUDED.privy_user_id, ${db(CONFIG.SCHEMA)}.user_wallet_links.privy_user_id),
      fid = COALESCE(EXCLUDED.fid, ${db(CONFIG.SCHEMA)}.user_wallet_links.fid),
      x_username = COALESCE(EXCLUDED.x_username, ${db(CONFIG.SCHEMA)}.user_wallet_links.x_username),
      seen_via_privy = ${db(CONFIG.SCHEMA)}.user_wallet_links.seen_via_privy OR EXCLUDED.seen_via_privy,
      seen_via_farcaster = ${db(CONFIG.SCHEMA)}.user_wallet_links.seen_via_farcaster OR EXCLUDED.seen_via_farcaster,
      farcaster_verified = ${db(CONFIG.SCHEMA)}.user_wallet_links.farcaster_verified OR EXCLUDED.farcaster_verified,
      last_seen_requester_wallet = EXCLUDED.last_seen_requester_wallet,
      last_seen_at = NOW()
  `
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
