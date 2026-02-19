import { Hono } from 'hono'
import { normalizeAddress, toSupportedChain } from '../config'
import { getBungalowOwnerRecord, getInstalledWidgets, installWidget } from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { logInfo } from '../services/logger'
import type { AppEnv } from '../types'

type WidgetDefinition = {
  id: string
  name: string
  description: string
  package_name: string
  version: string
  repo_url: string
  category: 'analytics' | 'social' | 'governance' | 'commerce'
}

const WIDGET_CATALOG: WidgetDefinition[] = [
  {
    id: 'holder-sparkline',
    name: 'Holder Sparkline',
    description: 'Embeds a lightweight chart for holder growth and 24h movement.',
    package_name: '@memetics/widget-holder-sparkline',
    version: '^0.1.0',
    repo_url: 'https://github.com/memetics/widgets/tree/main/packages/holder-sparkline',
    category: 'analytics',
  },
  {
    id: 'farcaster-cast-wall',
    name: 'Farcaster Cast Wall',
    description: 'Streams recent Farcaster casts tagged for this bungalow token.',
    package_name: '@memetics/widget-cast-wall',
    version: '^0.1.0',
    repo_url: 'https://github.com/memetics/widgets/tree/main/packages/cast-wall',
    category: 'social',
  },
  {
    id: 'snapshot-vote-card',
    name: 'Snapshot Vote Card',
    description: 'Adds an action card for active Snapshot proposals.',
    package_name: '@memetics/widget-snapshot-card',
    version: '^0.1.0',
    repo_url: 'https://github.com/memetics/widgets/tree/main/packages/snapshot-card',
    category: 'governance',
  },
  {
    id: 'treasury-links',
    name: 'Treasury Links',
    description: 'Displays canonical treasury/multisig links and explorers.',
    package_name: '@memetics/widget-treasury-links',
    version: '^0.1.0',
    repo_url: 'https://github.com/memetics/widgets/tree/main/packages/treasury-links',
    category: 'commerce',
  },
]

const widgetRoute = new Hono<AppEnv>()

widgetRoute.get('/bungalow/:chain/:ca/widgets/catalog', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_params', 'Invalid token address')
  }

  return c.json({
    chain,
    token_address: tokenAddress,
    items: WIDGET_CATALOG.map((widget) => ({
      ...widget,
      install_command: `bun add ${widget.package_name}@${widget.version}`,
    })),
  })
})

widgetRoute.get('/bungalow/:chain/:ca/widgets', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_params', 'Invalid token address')
  }

  const installed = await getInstalledWidgets(chain, tokenAddress)
  return c.json({
    chain,
    token_address: tokenAddress,
    items: installed,
    total: installed.length,
  })
})

widgetRoute.post('/bungalow/:chain/:ca/widgets/install', requireWalletAuth, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_params', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  const wallet = c.get('walletAddress')
  if (!tokenAddress || !wallet) {
    throw new ApiError(400, 'invalid_params', 'Invalid token address')
  }

  const ownerRecord = await getBungalowOwnerRecord(tokenAddress, chain)
  if (!ownerRecord?.current_owner) {
    throw new ApiError(409, 'bungalow_unclaimed', 'Bungalow must be claimed before installing widgets')
  }

  const owner = ownerRecord.current_owner.toLowerCase()
  const admin = ownerRecord.verified_admin?.toLowerCase() ?? null
  const caller = wallet.toLowerCase()
  if (caller !== owner && caller !== admin) {
    throw new ApiError(403, 'not_bungalow_owner', 'Only the bungalow owner can install widgets')
  }

  const body = await c.req.json<{ widget_id?: unknown; repo_url?: unknown }>()
  const widgetId = typeof body.widget_id === 'string' ? body.widget_id.trim() : ''
  if (!widgetId) {
    throw new ApiError(400, 'invalid_widget', 'widget_id is required')
  }

  const widget = WIDGET_CATALOG.find((item) => item.id === widgetId)
  if (!widget) {
    throw new ApiError(404, 'widget_not_found', 'Widget is not available in the catalog')
  }

  let repoUrl: string | null = null
  if (typeof body.repo_url === 'string' && body.repo_url.trim().length > 0) {
    try {
      const parsed = new URL(body.repo_url.trim())
      repoUrl = parsed.toString()
    } catch {
      throw new ApiError(400, 'invalid_repo_url', 'repo_url must be a valid URL')
    }
  }

  const install = await installWidget({
    chain,
    tokenAddress,
    widgetId: widget.id,
    packageName: widget.package_name,
    version: widget.version,
    repoUrl,
    installedBy: caller,
  })

  logInfo(
    'WIDGET INSTALL',
    `wallet=${caller} chain=${chain} token=${tokenAddress} widget=${widget.id} repo=${repoUrl ?? 'none'}`,
  )

  return c.json({
    install,
    widget,
    install_command: `bun add ${widget.package_name}@${widget.version}`,
    repo_steps: [
      'Add the package to your bungalow repo dependencies.',
      'Register the widget in your bungalow widget manifest.',
      'Commit and push so the widget can render in production.',
    ],
  }, 201)
})

export default widgetRoute
