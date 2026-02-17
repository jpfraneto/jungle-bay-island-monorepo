import type { JWTPayload } from 'jose'

export interface AppVariables {
  walletAddress?: string
  privyClaims?: JWTPayload
  requestId?: string
  agentName?: string
  agentId?: number
}

export type AppEnv = {
  Variables: AppVariables
}
