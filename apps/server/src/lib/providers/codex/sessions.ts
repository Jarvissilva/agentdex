import { homedir } from 'node:os';
import path from 'node:path';
import HttpError from '../../HttpError.js';
import { lockActivity } from '../activity.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StoredSession } from '@agentdex/shared';
import resolveExecutable from '../../resolveExecutable.js';

const sourceKinds = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function parseThread(value: unknown, archived: boolean): StoredSession {
  if (!value || typeof value !== 'object'
    || !('id' in value) || typeof value.id !== 'string'
    || !('cwd' in value) || typeof value.cwd !== 'string'
    || !('createdAt' in value) || typeof value.createdAt !== 'number'
    || !('updatedAt' in value) || typeof value.updatedAt !== 'number') {
    throw new Error('Codex returned invalid session metadata. Check your CLI version.');
  }
  const name = 'name' in value && typeof value.name === 'string' ? value.name.trim() : '';
  const preview = 'preview' in value && typeof value.preview === 'string' ? value.preview.trim() : '';
  return {
    id: value.id,
    title: (name || preview || 'Untitled session').replace(/\s+/g, ' ').slice(0, 200),
    workingDirectory: value.cwd,
    createdAt: new Date(value.createdAt * 1000).toISOString(),
    updatedAt: new Date(value.updatedAt * 1000).toISOString(),
    activity: 'unknown',
    ...('forkedFromId' in value && typeof value.forkedFromId === 'string' ? { parentId: value.forkedFromId } : {}),
    archived,
  };
}

export default async function listCodexSessions(command: string, sessionId?: string, title?: string): Promise<StoredSession[]> {
  const executable = await resolveExecutable(command, process.env.PATH);
  if (!executable) throw new Error('Codex was not found. Install Codex or set CODEX_BIN to its executable path.');
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on('error', () => fail(new Error('Unable to start Codex session discovery. Check CODEX_BIN.')));
  child.stdin.on('error', () => fail(new Error('Codex session discovery disconnected.')));
  child.on('exit', () => fail(new Error('Codex session discovery exited before completing.')));
  lines.on('line', (line) => {
    try {
      const message: unknown = JSON.parse(line);
      if (!message || typeof message !== 'object' || !('id' in message) || typeof message.id !== 'number') return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if ('error' in message) {
        const error = message.error;
        const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message : 'Check your CLI version and configuration.';
        if (sessionId && title === undefined && /active[ -]writer/i.test(detail)) {
          request.reject(new HttpError(409, 'Codex has an active writer for this session. Close it in Codex before deleting, then refresh and retry.'));
          return;
        }
        request.reject(new Error(`Codex could not complete the session operation: ${detail}`));
      }
      else if ('result' in message) request.resolve(message.result);
      else request.reject(new Error('Codex returned an invalid discovery response.'));
    } catch { fail(new Error('Codex returned an invalid discovery response.')); }
  });
  const timeout = setTimeout(() => {
    fail(new Error('Codex session discovery timed out. Try refreshing the list.'));
    child.kill('SIGKILL');
  }, 30000);
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'agentdex', version: '0.0.0' } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    if (sessionId) {
      if (title === undefined) await request('thread/delete', { threadId: sessionId });
      else await request('thread/name/set', { threadId: sessionId, name: title });
      return [];
    }
    const sessions = new Map<string, StoredSession>();
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      do {
        const result = await request('thread/list', { cursor, limit: 100, sortKey: 'updated_at', modelProviders: [], sourceKinds, archived });
        if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)
          || !('nextCursor' in result) || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
          throw new Error('Codex returned an invalid session list.');
        }
        for (const value of result.data) {
          const session = parseThread(value, archived);
          sessions.set(session.id, session);
        }
        cursor = result.nextCursor;
        if (cursor !== null) {
          if (seenCursors.has(cursor)) throw new Error('Codex repeated a session-list cursor. Try refreshing.');
          seenCursors.add(cursor);
        }
      } while (cursor !== null);
    }
    const entries = [...sessions.values()];
    const activity = await lockActivity(entries.map(({ id }) => path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'thread-writer-locks', `${id}.lock`)));
    return entries.map((entry, index) => ({ ...entry, activity: activity[index]! }));
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    child.kill();
    const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
    kill.unref();
  }
}
