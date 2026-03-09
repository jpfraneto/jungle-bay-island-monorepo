import { Hono } from 'hono'
import { CONFIG, db, normalizeAddress, publicClients, toSupportedChain } from '../config'
import {
  createAssetPurchase,
  createBungalowWallEvent,
  getAggregatedUserByWallets,
  getBungalowSceneConfig,
  getUserWallets,
  getWalletTokenHeats,
  upsertBungalowSceneConfig,
} from '../db/queries'
import { requirePrivyAuth, requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import type { AppEnv } from '../types'

type SlotType = 'wall-frame' | 'shelf' | 'portal' | 'floor' | 'link'
type DecorationType = 'image' | 'portal' | 'furniture' | 'social-link' | 'website-link' | 'decoration'
type SceneChain = 'base' | 'ethereum'

interface DecorationConfig {
  type: DecorationType
  name: string
  imageUrl?: string
  linkUrl?: string
  modelId?: string
  placedBy: string
  placedByHandle?: string | null
  placedAt: string
  jbmBurned: number
}

interface SlotConfig {
  slotId: string
  slotType: SlotType
  position: [number, number, number]
  rotation: [number, number, number]
  filled: boolean
  decoration?: DecorationConfig
}

interface SceneConfig {
  version: '1.0'
  bungalowId: string
  slots: SlotConfig[]
}

const sceneRoute = new Hono<AppEnv>()

const ASSET_CATALOG = [
  {
    id: 'frame-palms',
    name: 'Palm Vista Frame',
    type: 'image',
    category: 'Framed Images',
    price_jbm: 50_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=512&q=80',
    description: 'A tropical frame ready for your community image.',
  },
  {
    id: 'portal-meta',
    name: 'Meta Portal',
    type: 'portal',
    category: 'Portals',
    price_jbm: 1_000_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1533134486753-c833f0ed4866?w=512&q=80',
    description: 'A glowing portal to your project destination.',
  },
  {
    id: 'furniture-hammock',
    name: 'Woven Hammock',
    type: 'furniture',
    category: 'Furniture',
    price_jbm: 250_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=512&q=80',
    model_url: 'model://hammock/basic',
    description: 'Chill seating for a cozy interior corner.',
  },
  {
    id: 'social-x',
    name: 'X Social Link',
    type: 'social-link',
    category: 'Social Links',
    price_jbm: 69_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=512&q=80',
    description: 'Drop your X profile as an interactive link.',
  },
  {
    id: 'website-home',
    name: 'Website Beacon',
    type: 'website-link',
    category: 'Website Links',
    price_jbm: 100_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=512&q=80',
    description: 'Link the project website directly from the room.',
  },
  {
    id: 'decor-orchid',
    name: 'Orchid Cluster',
    type: 'decoration',
    category: 'Decorations',
    price_jbm: 100_000,
    thumbnail_url: 'https://images.unsplash.com/photo-1519337265831-281ec6cc8514?w=512&q=80',
    description: 'A tropical color accent for shelf or floor slots.',
    community_created: true,
    creator_name: 'Jungle Artisan',
  },
] as const

function createBackWallFrameSlots(): SlotConfig[] {
  const xPositions = [-2.8, -1.55, 1.55, 2.8]
  const yPositions = [1.65, 3.1]

  return yPositions.flatMap((y, rowIndex) =>
    xPositions.map((x, columnIndex) => ({
      slotId: `back-wall-frame-${rowIndex + 1}-${columnIndex + 1}`,
      slotType: 'wall-frame' as const,
      position: [x, y, -2.94] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      filled: false,
    })),
  )
}

function createSideWallFrameSlots(input: {
  prefix: 'left' | 'right'
  x: number
  rotationY: number
}): SlotConfig[] {
  const zPositions = [-1.8, 0, 1.8]
  const yPositions = [1.8, 3.2]

  return yPositions.flatMap((y, rowIndex) =>
    zPositions.map((z, columnIndex) => ({
      slotId: `${input.prefix}-wall-frame-${rowIndex + 1}-${columnIndex + 1}`,
      slotType: 'wall-frame' as const,
      position: [input.x, y, z] as [number, number, number],
      rotation: [0, input.rotationY, 0] as [number, number, number],
      filled: false,
    })),
  )
}

function createDefaultScene(chain: 'base' | 'ethereum', ca: string): SceneConfig {
  return {
    version: '1.0',
    bungalowId: `${chain}:${ca}`,
    slots: [
      ...createBackWallFrameSlots(),
      ...createSideWallFrameSlots({
        prefix: 'left',
        x: -3.94,
        rotationY: Math.PI / 2,
      }),
      ...createSideWallFrameSlots({
        prefix: 'right',
        x: 3.94,
        rotationY: -Math.PI / 2,
      }),
      { slotId: 'right-shelf-1', slotType: 'shelf', position: [3.7, 1.2, -0.8], rotation: [0, -Math.PI / 2, 0], filled: false },
      { slotId: 'right-shelf-2', slotType: 'shelf', position: [3.7, 1.2, 0.9], rotation: [0, -Math.PI / 2, 0], filled: false },
      { slotId: 'left-portal-1', slotType: 'portal', position: [-3.72, 1.5, 0], rotation: [0, Math.PI / 2, 0], filled: false },
      { slotId: 'floor-1', slotType: 'floor', position: [-1.7, 0.02, -0.4], rotation: [-Math.PI / 2, 0, 0], filled: false },
      { slotId: 'floor-2', slotType: 'floor', position: [1.7, 0.02, -0.2], rotation: [-Math.PI / 2, 0, 0], filled: false },
      { slotId: 'floor-3', slotType: 'floor', position: [-1.3, 0.02, 1.3], rotation: [-Math.PI / 2, 0, 0], filled: false },
      { slotId: 'floor-4', slotType: 'floor', position: [1.3, 0.02, 1.4], rotation: [-Math.PI / 2, 0, 0], filled: false },
    ],
  }
}

function coerceSceneValue(raw: unknown): Partial<SceneConfig> | null {
  if (!raw) return null

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as Partial<SceneConfig>
      }
    } catch {
      return null
    }

    return null
  }

  if (typeof raw === 'object') {
    return raw as Partial<SceneConfig>
  }

  return null
}

function normalizeScene(raw: unknown, fallback: SceneConfig): SceneConfig {
  const value = coerceSceneValue(raw)
  if (!value) return fallback
  const rawSlots = Array.isArray(value.slots) ? value.slots : []
  const savedSlots = new Map<string, Partial<SlotConfig>>()

  for (const rawSlot of rawSlots) {
    if (!rawSlot || typeof rawSlot !== 'object') continue
    const slotId =
      typeof (rawSlot as { slotId?: unknown }).slotId === 'string'
        ? ((rawSlot as { slotId: string }).slotId)
        : ''
    if (!slotId) continue
    savedSlots.set(slotId, rawSlot as Partial<SlotConfig>)
  }

  return {
    version: '1.0',
    bungalowId: typeof value.bungalowId === 'string' ? value.bungalowId : fallback.bungalowId,
    slots: fallback.slots.map((slot) => {
      const saved = savedSlots.get(slot.slotId)
      if (!saved) {
        return slot
      }

      const decoration =
        saved.decoration && typeof saved.decoration === 'object'
          ? (saved.decoration as DecorationConfig)
          : undefined
      const filled =
        typeof saved.filled === 'boolean' ? saved.filled : Boolean(decoration)

      return {
        ...slot,
        filled,
        decoration,
      }
    }),
  }
}

async function getConnectedUsername(wallet: string): Promise<string | null> {
  const rows = await db<Array<{ username: string | null }>>`
    SELECT COALESCE(wfp.username, u.x_username) AS username
    FROM (SELECT ${wallet}::text AS wallet) AS input
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON LOWER(wfp.wallet) = LOWER(input.wallet)
    LEFT JOIN ${db(CONFIG.SCHEMA)}.user_wallets uw
      ON LOWER(uw.address) = LOWER(input.wallet)
    LEFT JOIN ${db(CONFIG.SCHEMA)}.users u
      ON u.privy_user_id = uw.privy_user_id
    WHERE COALESCE(wfp.username, u.x_username) IS NOT NULL
    LIMIT 1
  `

  const username = rows[0]?.username?.trim() ?? ''
  return username || null
}

async function enrichSceneIdentities(scene: SceneConfig): Promise<SceneConfig> {
  const usernameCache = new Map<string, string | null>()

  const slots = await Promise.all(
    scene.slots.map(async (slot) => {
      const placedBy = slot.decoration?.placedBy?.trim()
      if (!slot.decoration || !placedBy) {
        return slot
      }

      const cacheKey = placedBy.toLowerCase()
      if (!usernameCache.has(cacheKey)) {
        usernameCache.set(cacheKey, await getConnectedUsername(placedBy))
      }

      const placedByHandle = usernameCache.get(cacheKey) ?? null
      if (!placedByHandle) {
        return slot
      }

      return {
        ...slot,
        decoration: {
          ...slot.decoration,
          placedByHandle,
        },
      }
    }),
  )

  return {
    ...scene,
    slots,
  }
}

function ensureSlot(shape: SceneConfig, slotId: string): SlotConfig {
  const match = shape.slots.find((slot) => slot.slotId === slotId)
  if (!match) {
    throw new ApiError(404, 'slot_not_found', 'Decoration slot does not exist in this bungalow scene')
  }
  return match
}

function extractPrivyUserId(claims: Record<string, unknown> | undefined): string | null {
  const privyUserId = typeof claims?.sub === 'string' ? claims.sub.trim() : ''
  return privyUserId || null
}

function toSceneChain(input: string): SceneChain | null {
  const chain = toSupportedChain(input)
  return chain === 'base' || chain === 'ethereum' ? chain : null
}

sceneRoute.get('/bungalow/:chain/:ca/scene', async (c) => {
  const chain = toSceneChain(c.req.param('chain'))
  const ca = normalizeAddress(c.req.param('ca'))

  if (!chain || !ca) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain or contract address')
  }

  const fallback = createDefaultScene(chain, ca)
  const existing = await getBungalowSceneConfig(chain, ca)
  const scene = await enrichSceneIdentities(
    normalizeScene(existing?.scene_config, fallback),
  )

  return c.json({ scene })
})

sceneRoute.put('/bungalow/:chain/:ca/scene', requirePrivyAuth, async (c) => {
  const chain = toSceneChain(c.req.param('chain'))
  const ca = normalizeAddress(c.req.param('ca'))
  const wallet = c.get('walletAddress')
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = extractPrivyUserId(claims)

  if (!chain || !ca || !privyUserId) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain, contract address, or authenticated user')
  }

  const body = await c.req.json<{ slotId?: unknown; decoration?: Partial<DecorationConfig> }>()
  const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : ''

  if (!slotId) {
    throw new ApiError(400, 'invalid_slot_id', 'slotId is required')
  }

  if (!body.decoration || typeof body.decoration !== 'object') {
    throw new ApiError(400, 'invalid_decoration', 'decoration object is required')
  }

  const rawType = body.decoration.type
  const rawName = body.decoration.name

  if (typeof rawType !== 'string' || typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new ApiError(400, 'invalid_decoration', 'decoration requires type and name')
  }

  const linkedWalletRows = await getUserWallets(privyUserId)
  const linkedWallets = linkedWalletRows
    .map((row) => normalizeAddress(row.address))
    .filter((address): address is string => Boolean(address))
  const scopedWallets = [...new Set([
    ...(wallet ? [wallet.toLowerCase()] : []),
    ...linkedWallets.map((address) => address.toLowerCase()),
  ])]
  const requestedPlacedBy =
    typeof body.decoration.placedBy === 'string'
      ? normalizeAddress(body.decoration.placedBy)
      : null
  const actorWallet =
    (requestedPlacedBy && scopedWallets.includes(requestedPlacedBy.toLowerCase())
      ? requestedPlacedBy
      : null) ??
    wallet ??
    linkedWallets[0] ??
    null

  if (!actorWallet || scopedWallets.length === 0) {
    throw new ApiError(401, 'wallet_required', 'Link a wallet before placing items in a bungalow')
  }

  const existing = await getBungalowSceneConfig(chain, ca)
  const baseline = normalizeScene(existing?.scene_config, createDefaultScene(chain, ca))
  ensureSlot(baseline, slotId)

  const now = new Date().toISOString()

  const decoration: DecorationConfig = {
    type: rawType as DecorationType,
    name: rawName.trim(),
    imageUrl: typeof body.decoration.imageUrl === 'string' ? body.decoration.imageUrl : undefined,
    linkUrl: typeof body.decoration.linkUrl === 'string' ? body.decoration.linkUrl : undefined,
    modelId: typeof body.decoration.modelId === 'string' ? body.decoration.modelId : undefined,
    placedBy: actorWallet,
    placedAt: now,
    jbmBurned: Number(body.decoration.jbmBurned ?? 0),
  }

  const updatedScene: SceneConfig = {
    ...baseline,
    slots: baseline.slots.map((slot) => {
      if (slot.slotId !== slotId) return slot
      return {
        ...slot,
        filled: true,
        decoration,
      }
    }),
  }

  const saved = await upsertBungalowSceneConfig({
    chain,
    contractAddress: ca,
    sceneConfig: updatedScene,
    updatedBy: actorWallet,
  })

  const [aggregatedUser, tokenHeats] = await Promise.all([
    getAggregatedUserByWallets(scopedWallets),
    getWalletTokenHeats(ca, scopedWallets),
  ])
  const wallEventType =
    decoration.type === 'image'
      ? 'add_art'
      : decoration.type === 'website-link' ||
          decoration.type === 'social-link' ||
          decoration.type === 'portal'
        ? 'add_build'
        : 'add_item'

  await createBungalowWallEvent({
    tokenAddress: ca,
    chain,
    wallet: actorWallet,
    eventType: wallEventType,
    detail: decoration.name,
    islandHeat: aggregatedUser?.island_heat ?? 0,
    tokenHeat: tokenHeats.reduce((sum, entry) => sum + entry.heat_degrees, 0),
  })

  return c.json({
    scene: await enrichSceneIdentities(
      normalizeScene(saved.scene_config, updatedScene),
    ),
  })
})

sceneRoute.get('/assets/catalog', async (c) => {
  return c.json({ items: ASSET_CATALOG })
})

sceneRoute.post('/assets/purchase', requireWalletAuth, async (c) => {
  const wallet = c.get('walletAddress')

  if (!wallet) {
    throw new ApiError(401, 'auth_required', 'Wallet authentication required')
  }

  const body = await c.req.json<{ chain?: unknown; ca?: unknown; slotId?: unknown; assetId?: unknown; txHash?: unknown }>()
  const chain = typeof body.chain === 'string' ? toSceneChain(body.chain) : null
  const ca = typeof body.ca === 'string' ? normalizeAddress(body.ca) : null
  const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : ''
  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : ''
  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : undefined

  if (!chain || !ca || !slotId || !assetId) {
    throw new ApiError(400, 'invalid_purchase_payload', 'chain, ca, slotId, and assetId are required')
  }

  const asset = ASSET_CATALOG.find((item) => item.id === assetId)
  if (!asset) {
    throw new ApiError(404, 'asset_not_found', 'Catalog item not found')
  }

  if (txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new ApiError(400, 'invalid_tx_hash', 'txHash must be a valid hex transaction hash')
    }

    try {
      await publicClients[chain].getTransactionReceipt({ hash: txHash as `0x${string}` })
    } catch {
      throw new ApiError(400, 'tx_not_found', 'Transaction hash not found on the selected chain')
    }
  }

  const purchase = await createAssetPurchase({
    chain,
    contractAddress: ca,
    slotId,
    assetId,
    wallet,
    txHash,
  })

  return c.json({
    purchase: {
      id: purchase.id,
      chain: purchase.chain,
      ca: purchase.contract_address,
      slotId: purchase.slot_id,
      assetId: purchase.asset_id,
      wallet: purchase.wallet,
      txHash: purchase.tx_hash ?? undefined,
      purchasedAt: purchase.purchased_at,
    },
  })
})

export default sceneRoute
