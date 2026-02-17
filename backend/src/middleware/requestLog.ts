import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'
import { logDebug, logInfo, logSuccess, logWarn } from '../services/logger'

export const requestLogMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path
  const requestId = c.get('requestId') ?? 'unknown'
  const query = c.req.query()
  const queryString = Object.keys(query).length > 0 ? ` query=${JSON.stringify(query)}` : ''
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown'
  const ua = c.req.header('user-agent') ?? 'unknown'

  logInfo('REQ', `request_id=${requestId} ${method} ${path}${queryString} ip=${ip} ua="${ua}"`)

  await next()

  const ms = Date.now() - start
  if (c.res.status >= 500) {
    logDebug('RES', `request_id=${requestId} ${method} ${path} status=${c.res.status} duration_ms=${ms}`)
  } else if (c.res.status >= 400) {
    logWarn('RES', `request_id=${requestId} ${method} ${path} status=${c.res.status} duration_ms=${ms}`)
  } else {
    logSuccess('RES', `request_id=${requestId} ${method} ${path} status=${c.res.status} duration_ms=${ms}`)
  }
}
