export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly path: string;

  constructor(params: {
    message: string;
    status: number;
    code: string;
    path: string;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code;
    this.path = params.path;
    this.requestId = params.requestId;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!isApiClientError(error)) return false;
  return error.status >= 500;
}

export function formatApiError(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error) return fallback;
  if (isApiClientError(error)) {
    const requestId = error.requestId ? ` (request ${error.requestId})` : '';
    return `${error.message}${requestId}`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
