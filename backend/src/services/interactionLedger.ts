import { CONFIG, db } from '../config'

let interactionLedgerPromise: Promise<void> | null = null

export interface InteractionLedgerInput {
  txHash: string
  chainId?: number | null
  contractAddress?: string | null
  action: string
  functionName?: string | null
  chain?: string | null
  tokenAddress?: string | null
  privyUserId?: string | null
  wallet?: string | null
  profileId?: number | null
  bungalowId?: number | null
  itemId?: number | null
  commissionId?: number | null
  applicationId?: number | null
  status?: string | null
  paymentTxHash?: string | null
  metadata?: Record<string, unknown> | null
}

export interface InteractionLedgerUpdate {
  contractAddress?: string | null
  functionName?: string | null
  wallet?: string | null
  profileId?: number | null
  bungalowId?: number | null
  itemId?: number | null
  commissionId?: number | null
  applicationId?: number | null
  status?: string | null
  blockNumber?: number | null
  confirmedAt?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown> | null
}

export interface InteractionLedgerRow {
  tx_hash: string
  action: string
  function_name: string | null
  status: string
  wallet: string | null
  profile_id: number | null
  bungalow_id: number | null
  item_id: number | null
  commission_id: number | null
  application_id: number | null
  block_number: number | null
  error_message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

async function ensureInteractionLedger(): Promise<void> {
  if (!interactionLedgerPromise) {
    interactionLedgerPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS ${db(CONFIG.SCHEMA)}.onchain_interactions (
          tx_hash TEXT PRIMARY KEY,
          chain_id INTEGER,
          contract_address TEXT,
          action TEXT NOT NULL,
          function_name TEXT,
          chain TEXT,
          token_address TEXT,
          privy_user_id TEXT,
          wallet TEXT,
          profile_id BIGINT,
          bungalow_id BIGINT,
          item_id BIGINT,
          commission_id BIGINT,
          application_id BIGINT,
          status TEXT NOT NULL DEFAULT 'submitted',
          block_number BIGINT,
          error_message TEXT,
          payment_tx_hash TEXT,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ
        )
      `

      for (const definition of [
        'chain_id INTEGER',
        'function_name TEXT',
        'item_id BIGINT',
        'application_id BIGINT',
        `status TEXT NOT NULL DEFAULT 'submitted'`,
        'block_number BIGINT',
        'error_message TEXT',
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        'confirmed_at TIMESTAMPTZ',
      ]) {
        await db.unsafe(
          `ALTER TABLE "${CONFIG.SCHEMA}".onchain_interactions ADD COLUMN IF NOT EXISTS ${definition}`,
        )
      }

      await db`
        CREATE INDEX IF NOT EXISTS idx_onchain_interactions_lookup
        ON ${db(CONFIG.SCHEMA)}.onchain_interactions (
          action,
          chain,
          token_address,
          created_at DESC
        )
      `
    })()
  }

  await interactionLedgerPromise
}

export async function recordOnchainInteraction(input: InteractionLedgerInput): Promise<void> {
  await ensureInteractionLedger()

  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.onchain_interactions (
      tx_hash,
      chain_id,
      contract_address,
      action,
      function_name,
      chain,
      token_address,
      privy_user_id,
      wallet,
      profile_id,
      bungalow_id,
      item_id,
      commission_id,
      application_id,
      status,
      payment_tx_hash,
      metadata,
      updated_at
    )
    VALUES (
      ${input.txHash.toLowerCase()},
      ${input.chainId ?? null},
      ${input.contractAddress ?? null},
      ${input.action},
      ${input.functionName ?? null},
      ${input.chain ?? null},
      ${input.tokenAddress ?? null},
      ${input.privyUserId ?? null},
      ${input.wallet ?? null},
      ${input.profileId ?? null},
      ${input.bungalowId ?? null},
      ${input.itemId ?? null},
      ${input.commissionId ?? null},
      ${input.applicationId ?? null},
      ${input.status ?? 'submitted'},
      ${input.paymentTxHash?.toLowerCase() ?? null},
      ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
      NOW()
    )
    ON CONFLICT (tx_hash)
    DO UPDATE SET
      chain_id = COALESCE(EXCLUDED.chain_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.chain_id),
      contract_address = COALESCE(EXCLUDED.contract_address, ${db(CONFIG.SCHEMA)}.onchain_interactions.contract_address),
      action = EXCLUDED.action,
      function_name = COALESCE(EXCLUDED.function_name, ${db(CONFIG.SCHEMA)}.onchain_interactions.function_name),
      chain = COALESCE(EXCLUDED.chain, ${db(CONFIG.SCHEMA)}.onchain_interactions.chain),
      token_address = COALESCE(EXCLUDED.token_address, ${db(CONFIG.SCHEMA)}.onchain_interactions.token_address),
      privy_user_id = COALESCE(EXCLUDED.privy_user_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.privy_user_id),
      wallet = COALESCE(EXCLUDED.wallet, ${db(CONFIG.SCHEMA)}.onchain_interactions.wallet),
      profile_id = COALESCE(EXCLUDED.profile_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.profile_id),
      bungalow_id = COALESCE(EXCLUDED.bungalow_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.bungalow_id),
      item_id = COALESCE(EXCLUDED.item_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.item_id),
      commission_id = COALESCE(EXCLUDED.commission_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.commission_id),
      application_id = COALESCE(EXCLUDED.application_id, ${db(CONFIG.SCHEMA)}.onchain_interactions.application_id),
      status = COALESCE(EXCLUDED.status, ${db(CONFIG.SCHEMA)}.onchain_interactions.status),
      payment_tx_hash = COALESCE(EXCLUDED.payment_tx_hash, ${db(CONFIG.SCHEMA)}.onchain_interactions.payment_tx_hash),
      metadata = COALESCE(EXCLUDED.metadata, ${db(CONFIG.SCHEMA)}.onchain_interactions.metadata),
      updated_at = NOW()
  `
}

export async function updateOnchainInteraction(
  txHash: string,
  input: InteractionLedgerUpdate,
): Promise<void> {
  await ensureInteractionLedger()

  await db`
    UPDATE ${db(CONFIG.SCHEMA)}.onchain_interactions
    SET
      contract_address = COALESCE(${input.contractAddress ?? null}, contract_address),
      function_name = COALESCE(${input.functionName ?? null}, function_name),
      wallet = COALESCE(${input.wallet ?? null}, wallet),
      profile_id = COALESCE(${input.profileId ?? null}, profile_id),
      bungalow_id = COALESCE(${input.bungalowId ?? null}, bungalow_id),
      item_id = COALESCE(${input.itemId ?? null}, item_id),
      commission_id = COALESCE(${input.commissionId ?? null}, commission_id),
      application_id = COALESCE(${input.applicationId ?? null}, application_id),
      status = COALESCE(${input.status ?? null}, status),
      block_number = COALESCE(${input.blockNumber ?? null}, block_number),
      error_message = COALESCE(${input.errorMessage ?? null}, error_message),
      metadata = COALESCE(${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb, metadata),
      confirmed_at = COALESCE(${input.confirmedAt ?? null}::timestamptz, confirmed_at),
      updated_at = NOW()
    WHERE tx_hash = ${txHash.toLowerCase()}
  `
}

export async function listOnchainInteractions(input?: {
  wallet?: string | null
  profileId?: number | null
  bungalowId?: number | null
  commissionId?: number | null
  limit?: number
}): Promise<InteractionLedgerRow[]> {
  await ensureInteractionLedger()

  const limit = Math.max(1, Math.min(100, input?.limit ?? 12))
  const params: Array<string | number> = []
  const where: string[] = []

  if (input?.wallet) {
    params.push(input.wallet.toLowerCase())
    where.push(`LOWER(wallet) = $${params.length}`)
  }

  if (typeof input?.profileId === 'number' && Number.isFinite(input.profileId)) {
    params.push(input.profileId)
    where.push(`profile_id = $${params.length}`)
  }

  if (typeof input?.bungalowId === 'number' && Number.isFinite(input.bungalowId)) {
    params.push(input.bungalowId)
    where.push(`bungalow_id = $${params.length}`)
  }

  if (typeof input?.commissionId === 'number' && Number.isFinite(input.commissionId)) {
    params.push(input.commissionId)
    where.push(`commission_id = $${params.length}`)
  }

  params.push(limit)

  return await db.unsafe<InteractionLedgerRow[]>(
    `
      SELECT
        tx_hash,
        action,
        function_name,
        status,
        wallet,
        profile_id::int AS profile_id,
        bungalow_id::int AS bungalow_id,
        item_id::int AS item_id,
        commission_id::int AS commission_id,
        application_id::int AS application_id,
        block_number::int AS block_number,
        error_message,
        COALESCE(metadata, '{}'::jsonb) AS metadata,
        created_at::text AS created_at,
        updated_at::text AS updated_at,
        confirmed_at::text AS confirmed_at
      FROM "${CONFIG.SCHEMA}".onchain_interactions
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(confirmed_at, created_at) DESC, created_at DESC
      LIMIT $${params.length}
    `,
    params,
  )
}
