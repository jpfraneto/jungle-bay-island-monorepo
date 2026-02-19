import type { JWTPayload } from 'jose'
import { normalizeAddress } from '../config'
import { upsertUserWalletLinks, upsertWalletFarcasterProfile } from '../db/queries'
import { extractXUsername, lookupByXUsername } from './neynar'
import { getPrivyLinkedAccounts } from './privyClaims'

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

function parseWalletKindHint(candidate: Record<string, unknown>): WalletKind | null {
  const raw = (
    candidate.chain_type
    ?? candidate.chainType
    ?? candidate.chain
    ?? candidate.wallet_chain_type
  )

  if (typeof raw !== 'string') return null
  const hint = raw.toLowerCase()
  if (hint.includes('sol')) return 'solana'
  if (hint.includes('eth') || hint.includes('evm') || hint.includes('base')) return 'evm'
  return null
}

function normalizeWallet(input: string, preferredKind: WalletKind | null = null): NormalizedWallet | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (preferredKind === 'evm') {
    const evm = normalizeAddress(trimmed)
    if (evm) return { address: evm, wallet_kind: 'evm' }
  }

  if (preferredKind === 'solana') {
    const solana = normalizeAddress(trimmed, 'solana')
    if (solana) return { address: solana, wallet_kind: 'solana' }
  }

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
  flags: Partial<Pick<UserWalletMapEntry, 'linked_via_privy' | 'linked_via_farcaster' | 'farcaster_verified' | 'is_requester_wallet'>>,
): void {
  const key = mapKey(wallet)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, {
      address: wallet.address,
      wallet_kind: wallet.wallet_kind,
      linked_via_privy: Boolean(flags.linked_via_privy),
      linked_via_farcaster: Boolean(flags.linked_via_farcaster),
      farcaster_verified: Boolean(flags.farcaster_verified),
      is_requester_wallet: Boolean(flags.is_requester_wallet),
    })
    return
  }

  existing.linked_via_privy = existing.linked_via_privy || Boolean(flags.linked_via_privy)
  existing.linked_via_farcaster = existing.linked_via_farcaster || Boolean(flags.linked_via_farcaster)
  existing.farcaster_verified = existing.farcaster_verified || Boolean(flags.farcaster_verified)
  existing.is_requester_wallet = existing.is_requester_wallet || Boolean(flags.is_requester_wallet)
}

function extractPrivyWallets(claims?: Record<string, unknown> | JWTPayload): NormalizedWallet[] {
  if (!claims) return []

  const wallets = new Map<string, NormalizedWallet>()
  const linkedAccounts = getPrivyLinkedAccounts(claims)

  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : null
    if (type !== 'wallet' && type !== 'smart_wallet') continue

    const address = typeof candidate.address === 'string' ? candidate.address : null
    if (!address) continue

    const preferredKind = parseWalletKindHint(candidate)
    const normalized = normalizeWallet(address, preferredKind)
    if (!normalized) continue

    wallets.set(mapKey(normalized), normalized)
  }

  return [...wallets.values()]
}

function getPrivyUserId(claims?: Record<string, unknown> | JWTPayload): string | null {
  if (!claims) return null
  const value = claims.sub
  return typeof value === 'string' ? value : null
}

export async function resolveUserWalletMap(input: ResolveUserWalletMapInput): Promise<UserWalletMapResult> {
  const requester = normalizeWallet(input.requesterWallet)
  if (!requester) {
    const fallbackAddress = input.requesterWallet.trim().toLowerCase()
    throw new Error(`Invalid requester wallet: ${fallbackAddress}`)
  }

  const walletMap = new Map<string, UserWalletMapEntry>()
  addWallet(walletMap, requester, {
    linked_via_privy: true,
    is_requester_wallet: true,
  })

  const privyWallets = extractPrivyWallets(input.claims)
  for (const wallet of privyWallets) {
    addWallet(walletMap, wallet, { linked_via_privy: true })
  }

  const claimsRecord = input.claims as Record<string, unknown> | undefined
  const xUsername = claimsRecord ? extractXUsername(claimsRecord) : null

  let farcaster: {
    fid: number
    username: string
    display_name: string
    pfp_url: string
    wallets_found: number
  } | null = null

  if (xUsername) {
    const profile = await lookupByXUsername(xUsername)
    if (profile) {
      farcaster = {
        fid: profile.fid,
        username: profile.username,
        display_name: profile.displayName,
        pfp_url: profile.pfpUrl,
        wallets_found: profile.ethAddresses.length + profile.solAddresses.length,
      }

      for (const address of profile.ethAddresses) {
        const wallet = normalizeWallet(address, 'evm')
        if (!wallet) continue
        addWallet(walletMap, wallet, {
          linked_via_farcaster: true,
          farcaster_verified: true,
        })
      }

      for (const address of profile.solAddresses) {
        const wallet = normalizeWallet(address, 'solana')
        if (!wallet) continue
        addWallet(walletMap, wallet, {
          linked_via_farcaster: true,
          farcaster_verified: true,
        })
      }
    }
  }

  const wallets = [...walletMap.values()]
  const evmWallets = wallets.filter((wallet) => wallet.wallet_kind === 'evm').map((wallet) => wallet.address)
  const solanaWallets = wallets.filter((wallet) => wallet.wallet_kind === 'solana').map((wallet) => wallet.address)

  if (input.persist !== false) {
    await upsertUserWalletLinks({
      privyUserId: getPrivyUserId(input.claims),
      fid: farcaster?.fid ?? null,
      xUsername,
      rows: wallets.map((wallet) => ({
        wallet: wallet.address,
        wallet_kind: wallet.wallet_kind,
        seen_via_privy: wallet.linked_via_privy,
        seen_via_farcaster: wallet.linked_via_farcaster,
        farcaster_verified: wallet.farcaster_verified,
        last_seen_requester_wallet: wallet.is_requester_wallet,
      })),
    })

    if (farcaster) {
      for (const wallet of wallets) {
        if (!wallet.farcaster_verified) continue
        await upsertWalletFarcasterProfile(
          wallet.address,
          farcaster.fid,
          farcaster.username,
          farcaster.display_name,
          farcaster.pfp_url,
        )
      }
    }
  }

  return {
    requester_wallet: requester.address,
    requester_wallet_kind: requester.wallet_kind,
    x_username: xUsername,
    farcaster,
    wallets,
    evm_wallets: evmWallets,
    solana_wallets: solanaWallets,
    summary: {
      total_wallets: wallets.length,
      evm_wallets: evmWallets.length,
      solana_wallets: solanaWallets.length,
      farcaster_verified_wallets: wallets.filter((wallet) => wallet.farcaster_verified).length,
    },
  }
}
