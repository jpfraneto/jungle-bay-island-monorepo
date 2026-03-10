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
  upsertUser,
  upsertUserWalletLinks,
} from '../db/queries'
import { requirePrivyAuth, requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { getPrivyLinkedAccounts } from '../services/privyClaims'
import type { AppEnv } from '../types'

function extractXUsernameFromClaims(claims: Record<string, unknown> | undefined): string | null {
  if (!claims) return null
  const linkedAccounts = getPrivyLinkedAccounts(claims)
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''
    if (type === 'twitter_oauth' || type === 'twitter') {
      const raw =
        typeof candidate.username === 'string'
          ? candidate.username
          : typeof candidate.screen_name === 'string'
            ? candidate.screen_name
            : ''
      const clean = raw.trim().replace(/^@+/, '')
      if (clean) return `@${clean}`
    }
  }
  return null
}

function persistActorIdentity(
  wallet: string,
  privyUserId: string,
  claims: Record<string, unknown> | undefined,
): void {
  const walletKind: 'privy_siwe' | 'privy_siws' = normalizeAddress(wallet)
    ? 'privy_siwe'
    : 'privy_siws'
  void upsertUserWalletLinks(privyUserId, wallet, walletKind).catch(() => {})
  const xUsername = extractXUsernameFromClaims(claims)
  if (xUsername) {
    void upsertUser(privyUserId, { x_username: xUsername }).catch(() => {})
  }
}

type SlotType = 'wall-frame' | 'shelf' | 'portal' | 'floor' | 'link'
type DecorationType = 'image' | 'portal' | 'furniture' | 'social-link' | 'website-link' | 'decoration'
type SceneBungalowChain = 'base' | 'ethereum' | 'solana'
type ScenePurchaseChain = 'base' | 'ethereum'
type WallPlacementItemType = 'art' | 'link'

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

type WallSurface = 'back' | 'left' | 'right'

const sceneRoute = new Hono<AppEnv>()
const WALL_PLACEMENT_PRICES: Record<WallPlacementItemType, bigint> = {
  art: 69_000n,
  link: 111_000n,
}

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

function createDefaultScene(chain: SceneBungalowChain, ca: string): SceneConfig {
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

function parseVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null
  }

  const entries = value.map((entry) => Number(entry))
  if (entries.some((entry) => !Number.isFinite(entry))) {
    return null
  }

  return [entries[0], entries[1], entries[2]]
}

function normalizeSavedSlot(rawSlot: unknown): SlotConfig | null {
  if (!rawSlot || typeof rawSlot !== 'object') {
    return null
  }

  const candidate = rawSlot as Partial<SlotConfig>
  const slotId = typeof candidate.slotId === 'string' ? candidate.slotId.trim() : ''
  const slotType =
    candidate.slotType === 'wall-frame' ||
    candidate.slotType === 'shelf' ||
    candidate.slotType === 'portal' ||
    candidate.slotType === 'floor' ||
    candidate.slotType === 'link'
      ? candidate.slotType
      : null
  const position = parseVec3(candidate.position)
  const rotation = parseVec3(candidate.rotation)

  if (!slotId || !slotType || !position || !rotation) {
    return null
  }

  const decoration =
    candidate.decoration && typeof candidate.decoration === 'object'
      ? (candidate.decoration as DecorationConfig)
      : undefined
  const filled =
    typeof candidate.filled === 'boolean'
      ? candidate.filled
      : Boolean(decoration)

  return {
    slotId,
    slotType,
    position,
    rotation,
    filled,
    decoration,
  }
}

function isWallDecorationType(type: DecorationType): boolean {
  return (
    type === 'image' ||
    type === 'website-link' ||
    type === 'social-link'
  )
}

function isFloorDecorationType(type: DecorationType): boolean {
  return type === 'decoration' || type === 'furniture'
}

function getNextAutoSlotNumber(scene: SceneConfig, prefix: string): number {
  const matching = scene.slots
    .map((slot) => {
      const match = slot.slotId.match(new RegExp(`^${prefix}-(\\d+)$`))
      return match ? Number(match[1]) : 0
    })
    .filter((value) => Number.isFinite(value))

  return (matching.length > 0 ? Math.max(...matching) : 0) + 1
}

function createAutoWallSlot(scene: SceneConfig): SlotConfig {
  // All filled wall-type slots in the scene (includes both default and auto slots).
  const wallSlots = scene.slots.filter(
    (slot) => slot.filled && slot.decoration && isWallDecorationType(slot.decoration.type),
  )
  const totalOccupied = wallSlots.length

  // Rotation around Y identifies the wall:
  //   back  → rotation[1] ≈ 0
  //   left  → rotation[1] ≈ +π/2
  //   right → rotation[1] ≈ -π/2
  function wallSurfaceOf(slot: SlotConfig): WallSurface {
    const ry = slot.rotation[1]
    if (ry > 0.1) return 'left'
    if (ry < -0.1) return 'right'
    return 'back'
  }

  // Distribute new pieces with a 3-back / 2-left / 2-right cycle so the back
  // wall fills up first, then the sides get used.
  const surfaceOrder: WallSurface[] = ['back', 'back', 'left', 'right', 'back', 'left', 'right']
  const surface = surfaceOrder[totalOccupied % surfaceOrder.length]

  // Count how many pieces already sit on THIS surface — used to pick the next
  // unique (column, row) pair so pieces never stack on the same spot.
  const surfaceOccupied = wallSlots.filter((s) => wallSurfaceOf(s) === surface).length

  // ── Back wall ──────────────────────────────────────────────────────────────
  // Back wall face spans x ≈ ±3.064 (octagon apothem vertex).
  // SlotObject scales stored XZ by 1.9, so max safe stored x = (3.064 - 0.74) / 1.9 ≈ 1.22.
  // Four columns at ±0.9 / ±0.3 keeps every frame well clear of the corner posts.
  const backXPositions = [-0.9, -0.3, 0.3, 0.9]

  // ── Side walls ─────────────────────────────────────────────────────────────
  // Left / right faces span z ≈ ±3.064.  Same frame-margin math → max stored |z| ≈ 1.22.
  const sideZPositions = [-1.1, -0.4, 0.4, 1.1]

  // ── Vertical ───────────────────────────────────────────────────────────────
  // CommunityWallDisplay inner panel: y 1.45 – 4.75.
  // Frame half-height 0.74; attribution label sits at y_centre – 0.95.
  // Starting at 2.1 keeps the lowest label line (2.1 – 0.95 = 1.15) inside the panel.
  const yPositions = [2.1, 2.9, 3.65]

  // ── Depth relative to wall face ────────────────────────────────────────────
  // CommunityWallDisplay centre is at z = -(ROOM_APOTHEM - 0.74) ≈ -6.66.
  // stored_z × 1.9 ≈ -6.54  →  frame back-face at -6.63, just in front of the panel.
  // Side walls sit at x ≈ ±7.4; stored_x × 1.9 ≈ ±7.30 puts frames ~0.1 in front.
  const BACK_WALL_Z = -3.44
  const SIDE_WALL_X = 3.84

  const posArr = surface === 'back' ? backXPositions : sideZPositions
  const column = surfaceOccupied % posArr.length
  const row = Math.floor(surfaceOccupied / posArr.length) % yPositions.length
  const tilt = ((totalOccupied % 5) - 2) * 0.04

  if (surface === 'back') {
    return {
      slotId: `auto-wall-${getNextAutoSlotNumber(scene, 'auto-wall')}`,
      slotType: 'wall-frame',
      position: [backXPositions[column], yPositions[row], BACK_WALL_Z],
      rotation: [0, 0, tilt],
      filled: false,
    }
  }

  const isLeft = surface === 'left'
  return {
    slotId: `auto-wall-${getNextAutoSlotNumber(scene, 'auto-wall')}`,
    slotType: 'wall-frame',
    position: [isLeft ? -SIDE_WALL_X : SIDE_WALL_X, yPositions[row], sideZPositions[column]],
    rotation: [0, isLeft ? Math.PI / 2 : -Math.PI / 2, tilt],
    filled: false,
  }
}

function createAutoFloorSlot(scene: SceneConfig): SlotConfig {
  const rings = [1.1, 1.6, 2.15, 2.75]
  const angles = [28, 62, 104, 142, 196, 234, 286, 328]
  const occupied = scene.slots.filter(
    (slot) => slot.filled && slot.decoration && isFloorDecorationType(slot.decoration.type),
  ).length
  const ring = rings[Math.floor(occupied / angles.length) % rings.length]
  const angleDeg = angles[occupied % angles.length] + ((occupied % 3) - 1) * 5
  const angle = (angleDeg * Math.PI) / 180

  return {
    slotId: `auto-floor-${getNextAutoSlotNumber(scene, 'auto-floor')}`,
    slotType: 'floor',
    position: [
      Number((Math.cos(angle) * ring).toFixed(3)),
      0.02,
      Number((Math.sin(angle) * ring).toFixed(3)),
    ],
    rotation: [-Math.PI / 2, 0, 0],
    filled: false,
  }
}

function createAutoPortalSlot(scene: SceneConfig): SlotConfig {
  const positions: Array<{ position: [number, number, number]; rotation: [number, number, number] }> = [
    { position: [-3.48, 1.45, -1.15], rotation: [0, Math.PI / 2, 0] },
    { position: [3.48, 1.45, -1.15], rotation: [0, -Math.PI / 2, 0] },
    { position: [-3.48, 1.45, 1.05], rotation: [0, Math.PI / 2, 0] },
    { position: [3.48, 1.45, 1.05], rotation: [0, -Math.PI / 2, 0] },
  ]
  const occupied = scene.slots.filter(
    (slot) => slot.filled && slot.decoration?.type === 'portal',
  ).length
  const chosen = positions[occupied % positions.length]

  return {
    slotId: `auto-portal-${getNextAutoSlotNumber(scene, 'auto-portal')}`,
    slotType: 'portal',
    position: chosen.position,
    rotation: chosen.rotation,
    filled: false,
  }
}

function createAutoPlacementSlot(
  scene: SceneConfig,
  decorationType: DecorationType,
): SlotConfig {
  if (decorationType === 'portal') {
    return createAutoPortalSlot(scene)
  }

  if (isFloorDecorationType(decorationType)) {
    return createAutoFloorSlot(scene)
  }

  return createAutoWallSlot(scene)
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
  const fallbackSlotIds = new Set(fallback.slots.map((slot) => slot.slotId))
  const customSlots: SlotConfig[] = []

  for (const rawSlot of rawSlots) {
    const normalized = normalizeSavedSlot(rawSlot)
    if (!normalized) continue
    if (fallbackSlotIds.has(normalized.slotId)) {
      savedSlots.set(normalized.slotId, normalized)
      continue
    }
    customSlots.push(normalized)
  }

  return {
    version: '1.0',
    bungalowId: typeof value.bungalowId === 'string' ? value.bungalowId : fallback.bungalowId,
    slots: [
      ...fallback.slots.map((slot) => {
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
      ...customSlots,
    ],
  }
}

async function getConnectedUsername(wallet: string): Promise<string | null> {
  const rows = await db<Array<{ username: string | null }>>`
    SELECT COALESCE(wfp.username, u_direct.x_username, u_linked.x_username) AS username
    FROM (SELECT ${wallet}::text AS wallet) AS input
    -- Farcaster profile mapped directly to this wallet
    LEFT JOIN ${db(CONFIG.SCHEMA)}.wallet_farcaster_profiles wfp
      ON LOWER(wfp.wallet) = LOWER(input.wallet)
    -- Privy-managed wallet → users row
    LEFT JOIN ${db(CONFIG.SCHEMA)}.user_wallets uw_direct
      ON LOWER(uw_direct.address) = LOWER(input.wallet)
    LEFT JOIN ${db(CONFIG.SCHEMA)}.users u_direct
      ON u_direct.privy_user_id = uw_direct.privy_user_id
    -- SIWE-linked wallet: wallet is the linked_wallet; resolve via its primary_wallet
    LEFT JOIN ${db(CONFIG.SCHEMA)}.user_wallet_links uwl
      ON LOWER(uwl.linked_wallet) = LOWER(input.wallet)
    LEFT JOIN ${db(CONFIG.SCHEMA)}.user_wallets uw_linked
      ON LOWER(uw_linked.address) = LOWER(uwl.primary_wallet)
    LEFT JOIN ${db(CONFIG.SCHEMA)}.users u_linked
      ON u_linked.privy_user_id = uw_linked.privy_user_id
    WHERE COALESCE(wfp.username, u_direct.x_username, u_linked.x_username) IS NOT NULL
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

function asTrimmedString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function parseWholeJbmAmount(input: unknown, fieldName: string): bigint {
  if (typeof input === 'bigint') {
    if (input <= 0n) {
      throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive JBM amount`)
    }
    return input
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input <= 0) {
      throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a whole-number JBM amount`)
    }
    return BigInt(input)
  }

  const raw = asTrimmedString(input)
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a whole-number JBM amount`)
  }

  try {
    const value = BigInt(raw)
    if (value <= 0n) {
      throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a positive JBM amount`)
    }
    return value
  } catch {
    throw new ApiError(400, 'invalid_numeric', `${fieldName} must be a whole-number JBM amount`)
  }
}

function validateTxHash(input: unknown): string {
  const txHash = asTrimmedString(input)
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }
  return txHash.toLowerCase()
}

function inferLinkDecorationType(url: string): DecorationType {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (
      hostname.includes('x.com') ||
      hostname.includes('twitter.com') ||
      hostname.includes('discord.com') ||
      hostname.includes('telegram.me') ||
      hostname.includes('t.me') ||
      hostname.includes('farcaster')
    ) {
      return 'social-link'
    }
  } catch {
    return 'website-link'
  }

  return 'website-link'
}

function deriveWallPlacementName(
  itemType: WallPlacementItemType,
  rawTitle: unknown,
  url: string,
): string {
  const title = asTrimmedString(rawTitle)
  if (title) {
    return title.slice(0, 100)
  }

  if (itemType === 'art') {
    return 'Wall Art'
  }

  try {
    return new URL(url).hostname.replace(/^www\./i, '') || 'Project Link'
  } catch {
    return 'Project Link'
  }
}

function toSceneBungalowChain(input: string): SceneBungalowChain | null {
  const chain = toSupportedChain(input)
  return chain
}

function toScenePurchaseChain(input: string): ScenePurchaseChain | null {
  const chain = toSupportedChain(input)
  return chain === 'base' || chain === 'ethereum' ? chain : null
}

async function resolveSceneActor(input: {
  privyUserId: string
  wallet: string | null
  placedBy?: string | null
}): Promise<{ actorWallet: string; scopedWallets: string[] }> {
  const linkedWalletRows = await getUserWallets(input.privyUserId)
  const linkedWallets = linkedWalletRows
    .map((row) => normalizeAddress(row.address) ?? normalizeAddress(row.address, 'solana'))
    .filter((address): address is string => Boolean(address))
  const scopedWallets = [...new Set([
    ...(input.wallet ? [input.wallet] : []),
    ...linkedWallets,
  ])]
  const scopedWalletKeys = new Set(scopedWallets.map((address) => address.toLowerCase()))
  const requestedPlacedBy = input.placedBy
    ? normalizeAddress(input.placedBy) ?? normalizeAddress(input.placedBy, 'solana')
    : null
  const actorWallet =
    (requestedPlacedBy && scopedWalletKeys.has(requestedPlacedBy.toLowerCase())
      ? requestedPlacedBy
      : null) ??
    input.wallet ??
    linkedWallets[0] ??
    null

  if (!actorWallet || scopedWallets.length === 0) {
    throw new ApiError(401, 'wallet_required', 'Link a wallet before placing items in a bungalow')
  }

  return {
    actorWallet,
    scopedWallets,
  }
}

function getWallEventType(decorationType: DecorationType): 'add_art' | 'add_build' | 'add_item' {
  if (decorationType === 'image') {
    return 'add_art'
  }

  if (
    decorationType === 'website-link' ||
    decorationType === 'social-link' ||
    decorationType === 'portal'
  ) {
    return 'add_build'
  }

  return 'add_item'
}

async function persistSceneDecoration(input: {
  chain: SceneBungalowChain
  ca: string
  slotId: string
  decoration: DecorationConfig
  actorWallet: string
  scopedWallets: string[]
}): Promise<{ scene: SceneConfig; resolvedSlotId: string }> {
  const existing = await getBungalowSceneConfig(input.chain, input.ca)
  const baseline = normalizeScene(existing?.scene_config, createDefaultScene(input.chain, input.ca))

  let resolvedSlotId = input.slotId
  let updatedSlots = [...baseline.slots]

  if (input.slotId === 'auto') {
    const nextSlot = createAutoPlacementSlot(baseline, input.decoration.type)
    updatedSlots = [...updatedSlots, nextSlot]
    resolvedSlotId = nextSlot.slotId
  } else {
    ensureSlot(baseline, input.slotId)
  }

  const updatedScene: SceneConfig = {
    ...baseline,
    slots: updatedSlots.map((slot) => {
      if (slot.slotId !== resolvedSlotId) return slot
      return {
        ...slot,
        filled: true,
        decoration: input.decoration,
      }
    }),
  }

  const saved = await upsertBungalowSceneConfig({
    chain: input.chain,
    contractAddress: input.ca,
    sceneConfig: updatedScene,
    updatedBy: input.actorWallet,
  })

  const [aggregatedUser, tokenHeats] = await Promise.all([
    getAggregatedUserByWallets(input.scopedWallets),
    getWalletTokenHeats(input.ca, input.scopedWallets),
  ])

  await createBungalowWallEvent({
    tokenAddress: input.ca,
    chain: input.chain,
    wallet: input.actorWallet,
    eventType: getWallEventType(input.decoration.type),
    detail: input.decoration.name,
    islandHeat: aggregatedUser?.island_heat ?? 0,
    tokenHeat: tokenHeats.reduce((sum, entry) => sum + entry.heat_degrees, 0),
  })

  return {
    scene: await enrichSceneIdentities(
      normalizeScene(saved.scene_config, updatedScene),
    ),
    resolvedSlotId,
  }
}

sceneRoute.get('/bungalow/:chain/:ca/scene', async (c) => {
  const chain = toSceneBungalowChain(c.req.param('chain'))
  const ca = chain ? normalizeAddress(c.req.param('ca'), chain) : null

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
  const chain = toSceneBungalowChain(c.req.param('chain'))
  const ca = chain ? normalizeAddress(c.req.param('ca'), chain) : null
  const wallet = c.get('walletAddress') ?? null
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = c.get('privyUserId') ?? extractPrivyUserId(claims)

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

  const { actorWallet, scopedWallets } = await resolveSceneActor({
    privyUserId,
    wallet,
    placedBy:
      typeof body.decoration.placedBy === 'string'
        ? body.decoration.placedBy
        : null,
  })

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

  const { scene } = await persistSceneDecoration({
    chain,
    ca,
    slotId,
    decoration,
    actorWallet,
    scopedWallets,
  })

  return c.json({ scene })
})

sceneRoute.post('/bungalow/:chain/:ca/wall-item', requirePrivyAuth, async (c) => {
  const chain = toSceneBungalowChain(c.req.param('chain'))
  const ca = chain ? normalizeAddress(c.req.param('ca'), chain) : null
  const wallet = c.get('walletAddress') ?? null
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = c.get('privyUserId') ?? extractPrivyUserId(claims)

  if (!chain || !ca || !privyUserId) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain, contract address, or authenticated user')
  }

  const body = await c.req.json<{
    item_type?: unknown
    title?: unknown
    url?: unknown
    placed_by?: unknown
    tx_hash?: unknown
    jbm_amount?: unknown
  }>()

  const itemType = asTrimmedString(body.item_type).toLowerCase() as WallPlacementItemType
  if (!(itemType in WALL_PLACEMENT_PRICES)) {
    throw new ApiError(400, 'invalid_item_type', 'item_type must be art or link')
  }

  const url = asTrimmedString(body.url)
  if (!url || !isHttpUrl(url)) {
    throw new ApiError(400, 'invalid_url', 'url must be a valid http(s) URL')
  }

  const txHash = validateTxHash(body.tx_hash)
  const jbmAmount = parseWholeJbmAmount(body.jbm_amount, 'jbm_amount')
  const expectedAmount = WALL_PLACEMENT_PRICES[itemType]
  if (jbmAmount !== expectedAmount) {
    throw new ApiError(
      400,
      'invalid_jbm_amount',
      `jbm_amount must equal ${expectedAmount.toString()} for ${itemType} wall placements`,
    )
  }

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

  const existingPurchases = await db<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM ${db(CONFIG.SCHEMA)}.asset_purchases
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `

  if (existingPurchases.length > 0) {
    const fallback = createDefaultScene(chain, ca)
    const existing = await getBungalowSceneConfig(chain, ca)
    const scene = await enrichSceneIdentities(
      normalizeScene(existing?.scene_config, fallback),
    )
    return c.json({ scene, idempotent: true }, 200)
  }

  const { actorWallet, scopedWallets } = await resolveSceneActor({
    privyUserId,
    wallet,
    placedBy: asTrimmedString(body.placed_by) || null,
  })

  // Persist the actor's wallet→identity link so username lookup works immediately.
  persistActorIdentity(actorWallet, privyUserId, claims)

  const decoration: DecorationConfig = {
    type: itemType === 'art' ? 'image' : inferLinkDecorationType(url),
    name: deriveWallPlacementName(itemType, body.title, url),
    imageUrl: itemType === 'art' ? url : undefined,
    linkUrl: itemType === 'link' ? url : undefined,
    placedBy: actorWallet,
    placedAt: new Date().toISOString(),
    jbmBurned: Number(expectedAmount),
  }

  const { scene, resolvedSlotId } = await persistSceneDecoration({
    chain,
    ca,
    slotId: 'auto',
    decoration,
    actorWallet,
    scopedWallets,
  })

  await createAssetPurchase({
    chain,
    contractAddress: ca,
    slotId: resolvedSlotId,
    assetId: itemType === 'art' ? 'wall-art' : 'wall-link',
    wallet: actorWallet,
    txHash,
  })

  return c.json({ scene, idempotent: false }, 201)
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
  const chain = typeof body.chain === 'string' ? toScenePurchaseChain(body.chain) : null
  const ca = chain && typeof body.ca === 'string' ? normalizeAddress(body.ca, chain) : null
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
