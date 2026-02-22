import { logInfo, logError } from './logger'

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

export interface SolanaTokenMeta {
  name: string | null
  symbol: string | null
  image: string | null
  description: string | null
  twitter: string | null
  website: string | null
}

export async function fetchSolanaTokenMetadata(mintAddress: string): Promise<SolanaTokenMeta | null> {
  try {
    // 1. Fetch on-chain metadata via getAccountInfo (Token-2022 metadata extension or Metaplex)
    const rpcRes = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [mintAddress, { encoding: 'jsonParsed' }],
      }),
      signal: AbortSignal.timeout(10_000),
    })

    const rpcData = await rpcRes.json() as any
    const info = rpcData?.result?.value?.data?.parsed?.info
    if (!info) {
      logInfo('SOLANA META', `No parsed account info for ${mintAddress}`)
      return null
    }

    // Extract from Token-2022 tokenMetadata extension
    const extensions: any[] = info.extensions ?? []
    const metaExt = extensions.find((e: any) => e.extension === 'tokenMetadata')
    const state = metaExt?.state

    let name = state?.name ?? null
    let symbol = state?.symbol ?? null
    let uri = state?.uri ?? null

    if (!name && !symbol) {
      logInfo('SOLANA META', `No metadata extension for ${mintAddress}`)
      return null
    }

    logInfo('SOLANA META', `Found on-chain: name=${name} symbol=${symbol} uri=${uri ? 'yes' : 'no'}`)

    // 2. If there's a metadata URI, fetch it for image/description/links
    let image: string | null = null
    let description: string | null = null
    let twitter: string | null = null
    let website: string | null = null

    if (uri) {
      try {
        const metaRes = await fetch(uri, {
          signal: AbortSignal.timeout(10_000),
        })
        if (metaRes.ok) {
          const meta = await metaRes.json() as any
          image = meta.image ?? null
          description = meta.description ?? null
          twitter = meta.twitter ?? null
          website = meta.website ?? null
          // Some tokens put name/symbol in the JSON too
          if (!name && meta.name) name = meta.name
          if (!symbol && meta.symbol) symbol = meta.symbol
        }
      } catch (uriErr) {
        logError('SOLANA META', `Failed to fetch URI ${uri}: ${uriErr instanceof Error ? uriErr.message : 'unknown'}`)
      }
    }

    return { name, symbol, image, description, twitter, website }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logError('SOLANA META', `Failed for ${mintAddress}: ${msg}`)
    return null
  }
}
