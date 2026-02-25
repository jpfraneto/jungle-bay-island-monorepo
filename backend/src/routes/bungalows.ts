import { Hono } from 'hono'
import { getBungalowsDirectory, getGlobalBulletinFeed, getRecentActivity } from '../db/queries'
import { logInfo } from '../services/logger'

const bungalowsRoute = new Hono()

bungalowsRoute.get('/bungalows', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  const { items, total } = await getBungalowsDirectory({ limit, offset })

  logInfo('BUNGALOWS', `total=${total} returned=${items.length} limit=${limit} offset=${offset}`)

  return c.json({
    items: items.map((item) => ({
      chain: item.chain,
      ca: item.token_address,
      token_address: item.token_address,
      token_name: item.name,
      name: item.name,
      token_symbol: item.symbol,
      symbol: item.symbol,
      holder_count: item.holder_count,
      image_url: item.image_url ?? null,
      claimed: item.is_claimed,
      is_claimed: item.is_claimed,
      scanned: item.scan_status === 'complete',
      scan_status: item.scan_status,
    })),
    total,
  })
})

bungalowsRoute.get('/feed', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '20', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  const { posts, total } = await getGlobalBulletinFeed(limit, offset)

  return c.json({ posts, total })
})

bungalowsRoute.get('/activity', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '20', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20

  const events = await getRecentActivity(limit)

  return c.json({ events })
})

export default bungalowsRoute
