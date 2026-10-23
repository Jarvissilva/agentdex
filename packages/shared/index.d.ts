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
}

export interface Session {
  id: string;
  provider: string;
  workingDirectory: string;
  status: 'running' | 'exited';
  startedAt: string;
  exitCode: number | null;
}

export interface SessionsResponse {
  session: Session | null;
  sessions: ProviderSession[];
  discoveryErrors: { provider: string; error: string }[];
  defaultWorkingDirectory: string;
}

export interface StoredSession {
  id: string;
  title: string;
  workingDirectory: string;
  createdAt: string;
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
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type TerminalServerMessage =
  | { type: 'snapshot'; data: string; session: Session }
  | { type: 'output'; data: string }
  | { type: 'exit'; session: Session };
