import type { SupportedChain } from '../config'
import { getBungalow } from '../db/queries'
import { getCached, setCached } from './cache'
import { fetchDexScreenerData } from './dexscreener'
import { fetchSolanaTokenMetadata } from './solanaMetadata'

const TOKEN_METADATA_CACHE_MS = 30 * 60 * 1000

export interface ResolvedTokenMetadata {
  tokenAddress: string
  chain: SupportedChain
  name: string | null
  symbol: string | null
  description: string | null
  image_url: string | null
  market_data: {
    price_usd: number | null
    market_cap: number | null
    volume_24h: number | null
    liquidity_usd: number | null
    updated_at: string | null
  } | null
  links: {
    x: string | null
    farcaster: string | null
    telegram: string | null
    website: string | null
    dexscreener: string | null
  }
}

function chainLabel(chain: SupportedChain): string {
  if (chain === 'base') return 'Base'
  if (chain === 'ethereum') return 'Ethereum'
  return 'Solana'
}

function fallbackDescription(
  chain: SupportedChain,
  tokenAddress: string,
  name: string | null,
  symbol: string | null,
): string {
  if (name && symbol) {
    return `${name} (${symbol}) on ${chainLabel(chain)} — view heat, holders, and bungalow activity on Jungle Bay Island.`
  }
  if (name) {
    return `${name} on ${chainLabel(chain)} — view heat, holders, and bungalow activity on Jungle Bay Island.`
  }
  return `View token ${tokenAddress} on ${chainLabel(chain)} in Jungle Bay Island.`
}

export async function resolveTokenMetadata(
  tokenAddress: string,
  chain: SupportedChain,
): Promise<ResolvedTokenMetadata> {
  const cacheKey = `token-meta:${chain}:${tokenAddress}`
  const cached = getCached<ResolvedTokenMetadata>(cacheKey)
  if (cached) return cached

  const bungalow = await getBungalow(tokenAddress, chain)
  const needsDexFallback = !bungalow || !bungalow.name || !bungalow.symbol || !bungalow.image_url
  const dexData = needsDexFallback ? await fetchDexScreenerData(tokenAddress, chain) : null

  // For Solana tokens, try on-chain metadata if DexScreener had nothing useful
  const needsSolanaFallback = chain === 'solana' && needsDexFallback && (!dexData?.tokenName || !dexData?.imageUrl)
  const solMeta = needsSolanaFallback ? await fetchSolanaTokenMetadata(tokenAddress) : null

  const name = bungalow?.name ?? dexData?.tokenName ?? solMeta?.name ?? null
  const symbol = bungalow?.symbol ?? dexData?.tokenSymbol ?? solMeta?.symbol ?? null
  const description = bungalow?.description ?? solMeta?.description ?? fallbackDescription(chain, tokenAddress, name, symbol)
  const image_url = bungalow?.image_url ?? dexData?.imageUrl ?? solMeta?.image ?? null

  const market_data = bungalow?.price_usd || bungalow?.market_cap || dexData?.priceUsd || dexData?.marketCap
    ? {
        price_usd: bungalow?.price_usd ? Number(bungalow.price_usd) : dexData?.priceUsd ?? null,
        market_cap: bungalow?.market_cap ? Number(bungalow.market_cap) : dexData?.marketCap ?? null,
        volume_24h: bungalow?.volume_24h ? Number(bungalow.volume_24h) : dexData?.volume24h ?? null,
        liquidity_usd: bungalow?.liquidity_usd ? Number(bungalow.liquidity_usd) : dexData?.liquidityUsd ?? null,
        updated_at: bungalow?.metadata_updated_at ?? null,
      }
    : null

  const resolved: ResolvedTokenMetadata = {
    tokenAddress,
    chain,
    name,
    symbol,
    description,
    image_url,
    market_data,
    links: {
      x: bungalow?.link_x ?? dexData?.linkX ?? solMeta?.twitter ?? null,
      farcaster: bungalow?.link_farcaster ?? null,
      telegram: bungalow?.link_telegram ?? dexData?.linkTelegram ?? null,
      website: bungalow?.link_website ?? dexData?.linkWebsite ?? solMeta?.website ?? null,
      dexscreener: bungalow?.link_dexscreener ?? dexData?.linkDexscreener ?? null,
    },
  }

  setCached(cacheKey, resolved, TOKEN_METADATA_CACHE_MS)
  return resolved
}
