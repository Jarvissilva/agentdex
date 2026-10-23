export type LibraryKind = 'skills' | 'mcps';
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
export interface LibraryInput {
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
}
export interface LibraryResponse { items: LibraryItem[] }
export interface SyncRequest { destinations: Destination[] }
export interface SyncResponse { results: PublicationStatus[] }
