export type LibraryKind = 'skills' | 'mcps' | 'agents';
export type Destination = 'agents' | 'antigravity' | 'codex' | 'opencode';
export interface McpDefinition {
  transport: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}
export interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
}
export interface LibraryInput {
  agent?: AgentDefinition;
  nativeName?: string;
  name: string;
  content?: string;
  definition?: McpDefinition;
}
export interface PublicationStatus {
  destination: Destination;
  status: 'installed' | 'outdated' | 'missing' | 'conflict' | 'error';
  message?: string;
}
export interface LibraryItem extends LibraryInput {
  id: string;
  nativeName: string;
  installations: PublicationStatus[];
  credentialMigrationRequired?: boolean;
}
export interface LibraryResponse { items: LibraryItem[] }
export interface McpCredentials { env?: Record<string, string>; headers?: Record<string, string> }
export interface SyncRequest {
  destinations: Destination[];
  credentialSource?: Destination;
  credentials?: McpCredentials;
}
export interface SyncResponse { results: PublicationStatus[] }
