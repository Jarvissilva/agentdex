import type { Provider, StoredSession } from '@agentdex/shared';

export interface ProviderLaunchConfig {
  executable: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ProviderAdapter extends Provider {
  installationHint: string;
  getLaunchConfig(workingDirectory: string): ProviderLaunchConfig;
  listSessions(): Promise<StoredSession[]>;
}
