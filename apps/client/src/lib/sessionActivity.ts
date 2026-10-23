import type { ProviderSession, Session } from '@agentdex/shared';

export type SessionStatusFilter = 'active' | 'needs-input' | 'inactive' | 'all';

export function sessionActivity(session: Session) {
  const label = session.status === 'exited' ? 'Exited' : session.taskActivity === 'running' || session.taskActivity === 'unknown' ? 'Running' : session.taskActivity === 'needs-input' ? 'Needs input' : session.taskActivity === 'not-running' ? 'Ready' : 'Unknown';
  return { label, needsInput: session.status === 'running' && session.taskActivity === 'needs-input', running: session.status === 'running' && (session.taskActivity === 'running' || session.taskActivity === 'unknown') };
}

// Writer/presence locks prove ownership, not that an external agent is working.
export function savedSessionActivity(session: ProviderSession, terminal?: Session) {
  if (terminal?.status === 'running') {
    const activity = sessionActivity(terminal);
    return activity.needsInput ? 'needs-input' : activity.running ? 'active' : terminal.taskActivity === 'not-running' ? 'inactive' : 'unknown';
  }
  if (session.activity === 'inactive') return 'inactive';
  return session.provider === 'opencode' ? session.activity : 'unknown';
}

export type SavedSessionRow = ProviderSession & { kind: 'saved'; terminal?: Session };
export type ManagedTerminalRow = Omit<ProviderSession, 'activity'> & { kind: 'managed'; terminal: Session };
export type SessionListRow = SavedSessionRow | ManagedTerminalRow;

export function sessionRowKey(row: SessionListRow) {
  return JSON.stringify([row.kind, row.provider, row.id]);
}

export function buildSessionRows(sessions: ProviderSession[], terminals: Session[], providers: { id: string; name: string }[]): SessionListRow[] {
  const rows: SessionListRow[] = sessions.map((session) => {
    const matches = terminals.filter((terminal) => terminal.provider === session.provider && terminal.providerSessionId === session.id);
    return { ...session, kind: 'saved', terminal: matches.find((terminal) => terminal.status === 'running') ?? matches.at(-1) };
  });
  for (const terminal of terminals) {
    if (terminal.status !== 'running' || sessions.some((session) => session.provider === terminal.provider && session.id === terminal.providerSessionId)) continue;
    rows.push({ kind: 'managed', terminal, provider: terminal.provider, id: terminal.id,
      title: `New ${providers.find((provider) => provider.id === terminal.provider)?.name ?? terminal.provider} session`,
      workingDirectory: terminal.workingDirectory, createdAt: terminal.startedAt, updatedAt: terminal.startedAt, archived: false });
  }
  return rows;
}

export function sessionRowActivity(row: SessionListRow) {
  if (row.kind === 'saved') return savedSessionActivity(row, row.terminal);
  const activity = sessionActivity(row.terminal);
  return activity.needsInput ? 'needs-input' : activity.running ? 'active' : 'inactive';
}
