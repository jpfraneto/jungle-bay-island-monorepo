import { Hono } from 'hono'
import { createAgent, getAgentByName, updateAgentProfile } from '../db/queries'
import { hashApiKey, requireAgentAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { logInfo, logSuccess } from '../services/logger'
import type { AppEnv } from '../types'

const agentRoute = new Hono<AppEnv>()

// POST /api/agents/register — create a new agent account
agentRoute.post('/agents/register', async (c) => {
  const body = await c.req.json<{
    agent_name?: unknown
    description?: unknown
    wallet?: unknown
  }>()

  const agentName = typeof body.agent_name === 'string' ? body.agent_name.trim() : ''
  if (!agentName || agentName.length < 2 || agentName.length > 40) {
    throw new ApiError(400, 'invalid_name', 'agent_name must be 2-40 characters')
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    throw new ApiError(400, 'invalid_name', 'agent_name must be alphanumeric with underscores/hyphens only')
  }

  // Check if name is taken
  const existing = await getAgentByName(agentName)
  if (existing) {
    throw new ApiError(409, 'name_taken', `Agent name "${agentName}" is already registered`)
  }

  // Generate API key
  const rawKey = `jbi_${generateRandomKey(32)}`
  const keyHash = await hashApiKey(rawKey)

  const description = typeof body.description === 'string'
    ? body.description.trim().slice(0, 280)
    : undefined

  const wallet = typeof body.wallet === 'string'
    ? body.wallet.trim().toLowerCase()
    : undefined

  const agent = await createAgent({
    agentName,
    apiKeyHash: keyHash,
    description,
    wallet,
  })

  logSuccess('AGENT REGISTER', `name=${agentName} id=${agent.id}`)

  return c.json({
    agent_name: agent.agent_name,
    api_key: rawKey,
    description: agent.description,
    wallet: agent.wallet,
    created_at: agent.created_at,
    message: 'Store this API key securely — it cannot be retrieved again. Use it in the X-API-Key header.',
  }, 201)
})

// GET /api/agents/me — get current agent profile (requires API key)
agentRoute.get('/agents/me', requireAgentAuth, async (c) => {
  const agentName = c.get('agentName')!
  const agent = await getAgentByName(agentName)

  if (!agent) {
    throw new ApiError(404, 'agent_not_found', 'Agent not found')
  }

  return c.json({
    agent_name: agent.agent_name,
    description: agent.description,
    wallet: agent.wallet,
    created_at: agent.created_at,
    last_used_at: agent.last_used_at,
  })
})

// PATCH /api/agents/me — update agent profile
agentRoute.patch('/agents/me', requireAgentAuth, async (c) => {
  const agentName = c.get('agentName')!
  const body = await c.req.json<Record<string, unknown>>()

  const fields: { description?: string | null; wallet?: string | null } = {}

  if (typeof body.description === 'string') {
    fields.description = body.description.trim().slice(0, 280) || null
  }
  if (typeof body.wallet === 'string') {
    fields.wallet = body.wallet.trim().toLowerCase() || null
  }

  if (Object.keys(fields).length === 0) {
    throw new ApiError(400, 'no_fields', 'No valid fields to update')
  }

  await updateAgentProfile(agentName, fields)
  logInfo('AGENT UPDATE', `name=${agentName} fields=${Object.keys(fields).join(',')}`)

  return c.json({ ok: true })
})

function generateRandomKey(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default agentRoute
