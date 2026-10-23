export interface LaunchDefaults { model: string; reasoning: string }
export interface Settings {
  defaultProviderId: string;
  startingDirectory: string;
  providers: Record<string, LaunchDefaults>;
  terminal: { fontSize: number; scrollback: number };
}
export interface ProviderModel { id: string; label: string; reasoning: string[]; reasoningKnown?: boolean }
export interface ModelsResponse { models: ProviderModel[]; status: 'available' | 'unavailable'; error?: string }
export interface ClearMemoryResponse { clearedIds: string[]; failures: { id: string; error: string }[] }
