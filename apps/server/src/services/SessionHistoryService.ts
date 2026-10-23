import { rejectActive } from '../lib/providers/activity.js';
import HttpError from '../lib/HttpError.js';
import type { ProviderSession, SessionsResponse } from '@agentdex/shared';
import type ProviderRegistry from '../lib/providers/index.js';

type History = Pick<SessionsResponse, 'sessions' | 'discoveryErrors'>;

export default class SessionHistoryService {
  private pending: Promise<History> | null = null;

  constructor(private readonly providers: ProviderRegistry) {}

  invalidate(): void { this.pending = null; }

  async renameSession(provider: string, id: string, value: unknown): Promise<void> {
    const adapter = this.providers.get(provider);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(id)) throw new HttpError(400, 'Invalid session ID.');
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new HttpError(400, 'Enter a session title of 1–200 characters on a single line.');
    }
    if (!adapter.renameSession) throw new HttpError(400, 'This provider does not support renaming sessions.');
    try {
      const sessions = await adapter.listSessions();
      if (!sessions.some((session) => session.id === id)) throw new HttpError(404, 'Saved session not found. Refresh the sessions explorer.');
      await adapter.renameSession(id, value.trim());
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, error instanceof Error ? error.message : 'Session rename failed. Retry.');
    } finally { this.invalidate(); }
  }

  async deleteSession(provider: string, id: string): Promise<void> {
    const adapter = this.providers.get(provider);
    try {
      const sessions = await adapter.listSessions().catch(() => []);
      const ids = new Set([id]);
      let size = 0;
      while (size !== ids.size) {
        size = ids.size;
        for (const session of sessions) if (session.parentId && ids.has(session.parentId)) ids.add(session.id);
      }
      rejectActive(sessions.filter((session) => ids.has(session.id)));
      await adapter.deleteSession(id);
    }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, error instanceof Error ? error.message : 'Session deletion failed. Retry.'); }
  }

  list(): Promise<History> {
    if (!this.pending) {
      const pending = this.discover().finally(() => { if (this.pending === pending) this.pending = null; });
      this.pending = pending;
    }
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
