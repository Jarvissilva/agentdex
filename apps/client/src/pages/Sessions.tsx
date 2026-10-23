import type { LoaderFunctionArgs } from 'react-router';
import type { SessionsResponse, ProvidersResponse } from '@agentdex/shared';
import { api } from '@/lib/api';

export async function sessionsLoader({ request }: LoaderFunctionArgs) {
  const [sessions, providers] = await Promise.all([
    api<SessionsResponse>('/sessions', { signal: request.signal }),
    api<ProvidersResponse>('/providers', { signal: request.signal }),
  ]);
  return { ...sessions, ...providers };
}
