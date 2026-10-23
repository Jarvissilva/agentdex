import type { ProviderSession, SessionsResponse } from '@agentdex/shared';
import type ProviderRegistry from '../lib/providers/index.js';

type History = Pick<SessionsResponse, 'sessions' | 'discoveryErrors'>;

export default class SessionHistoryService {
  private pending: Promise<History> | null = null;

  constructor(private readonly providers: ProviderRegistry) {}

  list(): Promise<History> {
    if (!this.pending) this.pending = this.discover().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async discover(): Promise<History> {
    const providers = this.providers.list();
    const results = await Promise.allSettled(providers.map(({ id }) => this.providers.get(id).listSessions()));
    const sessions = new Map<string, ProviderSession>();
    const discoveryErrors: History['discoveryErrors'] = [];
    results.forEach((result, index) => {
      const provider = providers[index]!;
      if (result.status === 'rejected') {
        discoveryErrors.push({ provider: provider.id, error: result.reason instanceof Error ? result.reason.message : 'Session discovery failed.' });
        return;
      }
      for (const session of result.value) sessions.set(`${provider.id}:${session.id}`, { ...session, provider: provider.id });
    });
    return {
      sessions: [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)),
      discoveryErrors,
    };
  }
}
