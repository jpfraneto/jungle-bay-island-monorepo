import { logError, logInfo } from './logger'

export interface DexScreenerData {
  tokenName: string | null
  tokenSymbol: string | null
  imageUrl: string | null
  priceUsd: number | null
  marketCap: number | null
  volume24h: number | null
  liquidityUsd: number | null
  linkWebsite: string | null
  linkX: string | null
  linkTelegram: string | null
  linkDexscreener: string | null
}

const CHAIN_MAP: Record<string, string> = {
  base: 'base',
  ethereum: 'ethereum',
  solana: 'solana',
}

export async function fetchDexScreenerData(
  tokenAddress: string,
  chain: string,
): Promise<DexScreenerData | null> {
  const chainId = CHAIN_MAP[chain]
  if (!chainId) return null

  try {
    const url = `https://api.dexscreener.com/tokens/v1/${chainId}/${tokenAddress}`
    logInfo('DEXSCREENER', `Fetching ${url}`)

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      logError('DEXSCREENER', `HTTP ${res.status} for ${tokenAddress}`)
      return null
    }

    const pairs = (await res.json()) as any[]
    if (!Array.isArray(pairs) || pairs.length === 0) {
      logInfo('DEXSCREENER', `No pairs found for ${tokenAddress}`)
      return null
    }

    // Sort by liquidity descending, pick best pair
    const sorted = pairs.sort(
      (a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0),
    )
    const best = sorted[0]

    // Extract image + socials from the info object
    const info = best.info ?? {}
    const imageUrl: string | null = info.imageUrl ?? null
    const socials: Array<{ type: string; url: string }> = Array.isArray(info.socials)
      ? info.socials
      : []
    const websites: Array<{ url: string }> = Array.isArray(info.websites)
      ? info.websites
      : []

    const findSocial = (type: string) =>
      socials.find((s) => s.type === type)?.url ?? null

    const dexscreenerUrl = best.url ?? null

    const baseToken = best.baseToken ?? {}

    const data: DexScreenerData = {
      tokenName: baseToken.name ?? null,
      tokenSymbol: baseToken.symbol ?? null,
      imageUrl,
      priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
      marketCap: best.marketCap ? Number(best.marketCap) : null,
      volume24h: best.volume?.h24 ? Number(best.volume.h24) : null,
      liquidityUsd: best.liquidity?.usd ? Number(best.liquidity.usd) : null,
      linkWebsite: websites[0]?.url ?? null,
      linkX: findSocial('twitter'),
      linkTelegram: findSocial('telegram'),
      linkDexscreener: dexscreenerUrl,
    }

    logInfo(
      'DEXSCREENER',
      `OK for ${tokenAddress}: price=$${data.priceUsd} mcap=$${data.marketCap} image=${Boolean(data.imageUrl)}`,
    )
    return data
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logError('DEXSCREENER', `Failed for ${tokenAddress}: ${msg}`)
    return null
  }
}
