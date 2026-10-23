import type { ApiError } from '@agentdex/shared';

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch {
    throw new ApiRequestError(503, 'Cannot reach the local server. Start it with pnpm dev.');
  }
  let body: T | ApiError;
  try { body = await response.json() as T | ApiError; } catch {
    throw new ApiRequestError(502, 'The local server returned an invalid response. Check that it is running.');
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status, typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : 'The request failed.');
  }
  return body as T;
}
