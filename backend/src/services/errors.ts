export class ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(error: unknown): error is ApiError {
  if (!(error instanceof Error)) return false
  if (!('status' in error) || !('code' in error)) return false
  const candidate = error as { status?: unknown; code?: unknown }
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string'
  )
}
