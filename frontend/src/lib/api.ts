import { API_URL } from '../config';
import { ApiClientError } from './apiError';

export interface ApiFetchOptions extends RequestInit {
  accessToken?: string;
  walletAddress?: string;
}

export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { accessToken, walletAddress, headers, ...rest } = options || {};

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (headers) {
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        requestHeaders[key] = value;
      });
    } else {
      Object.assign(requestHeaders, headers);
    }
  }

  if (accessToken) requestHeaders.Authorization = `Bearer ${accessToken}`;
  if (walletAddress) requestHeaders['X-Wallet-Address'] = walletAddress;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
    });
  } catch (error) {
    throw new ApiClientError({
      message: error instanceof Error ? error.message : `Network error calling ${API_URL}${path}`,
      status: 0,
      code: 'network_error',
      path,
    });
  }

  if (!res.ok) {
    let message = 'API error';
    let code = 'api_error';
    let requestId: string | undefined;
    try {
      const payload = await res.json();
      message = payload.error || payload.message || message;
      code = payload.code || code;
      requestId = payload.request_id;
    } catch {
      message = res.statusText || message;
    }
    throw new ApiClientError({
      message,
      status: res.status,
      code,
      path,
      requestId,
    });
  }

  return (await res.json()) as T;
}
