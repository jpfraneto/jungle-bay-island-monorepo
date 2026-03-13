import type { JWTPayload } from 'jose'
import { normalizeAddress } from '../config'
import { getUserWallets, upsertUser } from '../db/queries'
import { extractPrivyXUsername } from './privyClaims'

export type WalletKind = 'evm' | 'solana'

interface NormalizedWallet {
  address: string
  wallet_kind: WalletKind
}

export interface UserWalletMapEntry {
  address: string
  wallet_kind: WalletKind
  linked_via_privy: boolean
  linked_via_farcaster: boolean
  farcaster_verified: boolean
  is_requester_wallet: boolean
}

export interface UserWalletMapResult {
  requester_wallet: string
  requester_wallet_kind: WalletKind
  x_username: string | null
  farcaster: {
    fid: number
    username: string
    display_name: string
    pfp_url: string
    wallets_found: number
  } | null
  wallets: UserWalletMapEntry[]
  evm_wallets: string[]
  solana_wallets: string[]
  summary: {
    total_wallets: number
    evm_wallets: number
    solana_wallets: number
    farcaster_verified_wallets: number
  }
}

export interface ResolveUserWalletMapInput {
  requesterWallet: string
  claims?: Record<string, unknown> | JWTPayload
  persist?: boolean
}

function normalizeWallet(input: string): NormalizedWallet | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const evm = normalizeAddress(trimmed)
  if (evm) return { address: evm, wallet_kind: 'evm' }

  const solana = normalizeAddress(trimmed, 'solana')
  if (solana) return { address: solana, wallet_kind: 'solana' }

  return null
}

function mapKey(wallet: NormalizedWallet): string {
  return `${wallet.wallet_kind}:${wallet.address}`
}

function addWallet(
  map: Map<string, UserWalletMapEntry>,
  wallet: NormalizedWallet,
  flags: Partial<Pick<UserWalletMapEntry, 'linked_via_privy' | 'is_requester_wallet'>>,
): void {
  const key = mapKey(wallet)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, {
      address: wallet.address,
      wallet_kind: wallet.wallet_kind,
      linked_via_privy: Boolean(flags.linked_via_privy),
      linked_via_farcaster: false,
      farcaster_verified: false,
      is_requester_wallet: Boolean(flags.is_requester_wallet),
    })
    return
  }

  existing.linked_via_privy = existing.linked_via_privy || Boolean(flags.linked_via_privy)
  existing.is_requester_wallet = existing.is_requester_wallet || Boolean(flags.is_requester_wallet)
}

function getPrivyUserId(claims?: Record<string, unknown> | JWTPayload): string | null {
  if (!claims) return null
  const value = claims.sub
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, '').toLowerCase()
  return clean ? `@${clean}` : ''
}

function extractUsername(
  claims?: Record<string, unknown> | JWTPayload,
): string | null {
  if (!claims) return null
  const xUsername = extractPrivyXUsername(claims)
  return xUsername ? normalizeXUsername(xUsername) : null
}

export async function resolveUserWalletMap(input: ResolveUserWalletMapInput): Promise<UserWalletMapResult> {
  const requester = normalizeWallet(input.requesterWallet)
  if (!requester) {
    const fallbackAddress = input.requesterWallet.trim().toLowerCase()
    throw new Error(`Invalid requester wallet: ${fallbackAddress}`)
  }

  const privyUserId = getPrivyUserId(input.claims)
  const walletMap = new Map<string, UserWalletMapEntry>()

  let xUsername: string | null = null
  if (privyUserId) {
    xUsername = extractUsername(input.claims)

    if (input.persist !== false) {
      await upsertUser(privyUserId, {
        x_username: xUsername ?? undefined,
      })
    }

    const linkedWalletRows = await getUserWallets(privyUserId)
    for (const row of linkedWalletRows) {
      const normalized = normalizeWallet(row.address)
      if (!normalized) continue
      addWallet(walletMap, normalized, {
        linked_via_privy: true,
        is_requester_wallet: normalized.address === requester.address,
      })
    }
  } else {
    addWallet(walletMap, requester, {
      linked_via_privy: false,
      is_requester_wallet: true,
    })
  }

  const wallets = [...walletMap.values()]
  const evmWallets = wallets.filter((wallet) => wallet.wallet_kind === 'evm').map((wallet) => wallet.address)
  const solanaWallets = wallets.filter((wallet) => wallet.wallet_kind === 'solana').map((wallet) => wallet.address)

  return {
    requester_wallet: requester.address,
    requester_wallet_kind: requester.wallet_kind,
    x_username: xUsername,
    farcaster: null,
    wallets,
    evm_wallets: evmWallets,
    solana_wallets: solanaWallets,
    summary: {
      total_wallets: wallets.length,
      evm_wallets: evmWallets.length,
      solana_wallets: solanaWallets.length,
      farcaster_verified_wallets: 0,
    },
  }
}
