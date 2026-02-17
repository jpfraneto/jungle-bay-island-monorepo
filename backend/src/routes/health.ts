import { Hono } from 'hono'
import { checkDbHealth, getHealthSnapshot } from '../db/queries'

const healthRoute = new Hono()

healthRoute.get('/health', async (c) => {
  const dbOk = await checkDbHealth().catch(() => false)
  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'disconnected',
    ts: new Date().toISOString(),
  })
})

healthRoute.get('/health/deep', async (c) => {
  const started = Date.now()
  const snapshot = await getHealthSnapshot()
  return c.json({
    status: snapshot.db_connected ? 'ok' : 'degraded',
    db: snapshot.db_connected ? 'connected' : 'disconnected',
    schema: 'prod-v11',
    data: {
      personas_count: snapshot.personas_count,
      bungalows_count: snapshot.bungalows_count,
      scanned_tokens_count: snapshot.scanned_tokens_count,
      holder_rows_count: snapshot.holder_rows_count,
      latest_scan_at: snapshot.latest_scan_at,
    },
    diagnostics: {
      response_time_ms: Date.now() - started,
      ts: new Date().toISOString(),
    },
  })
})

export default healthRoute
