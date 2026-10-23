export interface Provider {
  id: string;
  name: string;
}

export interface ProvidersResponse {
  providers: Provider[];
  defaultProviderId: string;
}

export interface CreateSessionRequest {
  provider?: string;
  workingDirectory: string;
  resumeSessionId?: string;
}

export interface Session {
  id: string;
  provider: string;
  workingDirectory: string;
  status: 'running' | 'exited';
  taskActivity: 'running' | 'needs-input' | 'not-running' | 'unknown';
  providerSessionId?: string;
  startedAt: string;
  exitCode: number | null;
}

export interface SessionsResponse {
  session: Session | null;
  managedSessions: Session[];
  sessions: ProviderSession[];
  discoveryErrors: { provider: string; error: string }[];
  defaultWorkingDirectory: string;
  homeDirectory: string;
}

export interface StoredSession {
  /** Provider-reported task state, separate from process/writer presence. */
  taskActivity?: Session['taskActivity'];
  activity: 'active' | 'inactive' | 'unknown';
  parentId?: string;
  id: string;
  title: string;
  workingDirectory: string;
  createdAt: string | null;
  updatedAt: string;
  archived: boolean;
}

export interface ProviderSession extends StoredSession {
  provider: string;
}

export interface ApiError {
  error: string;
}

export type TerminalClientMessage =
  | { type: 'input'; data: string; encoding?: 'binary' }
  | { type: 'resize'; cols: number; rows: number };

export type TerminalServerMessage =
  | { type: 'snapshot'; data: string; cols: number; rows: number; session: Session }
  | { type: 'output'; data: string }
  | { type: 'exit'; session: Session };

export interface ManagedSessionsResponse {
  managedSessions: Session[];
}
