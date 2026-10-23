import type { Provider } from '@agentdex/shared';
import HttpError from '../HttpError.js';
import codex from './codex.js';
import type { ProviderAdapter } from './types.js';

export default class ProviderRegistry {
  private readonly adapters: Map<string, ProviderAdapter>;

  constructor(adapters: readonly ProviderAdapter[] = [codex], readonly defaultProviderId = 'codex') {
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    if (this.adapters.size !== adapters.length) throw new Error('Provider IDs must be unique.');
    if (!this.adapters.has(defaultProviderId)) throw new Error('The default provider must be registered.');
  }

  list(): Provider[] {
    return [...this.adapters.values()].map(({ id, name }) => ({ id, name }));
  }

  get(id: unknown = this.defaultProviderId): ProviderAdapter {
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Select a valid provider.');
    const adapter = this.adapters.get(id);
    if (!adapter) throw new HttpError(400, 'Unknown provider. Select a registered provider.');
    return adapter;
  }
}
