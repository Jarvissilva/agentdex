import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StoredSession } from '@agentdex/shared';
import resolveExecutable from '../resolveExecutable.js';

const execute = promisify(execFile);

function parseSession(value: unknown, archived: boolean): StoredSession {
  if (!value || typeof value !== 'object'
    || !('id' in value) || typeof value.id !== 'string' || !value.id
    || ('title' in value && value.title !== null && typeof value.title !== 'string')
    || !('time' in value) || !value.time || typeof value.time !== 'object'
    || !('created' in value.time) || typeof value.time.created !== 'number'
    || !('updated' in value.time) || typeof value.time.updated !== 'number'
    || !('location' in value) || !value.location || typeof value.location !== 'object'
    || !('directory' in value.location) || typeof value.location.directory !== 'string') {
    throw new Error('OpenCode returned invalid session metadata. Check your CLI version.');
  }
  const createdAt = new Date(value.time.created);
  const updatedAt = new Date(value.time.updated);
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
    throw new Error('OpenCode returned invalid session timestamps.');
  }
  return {
    id: value.id,
    title: ('title' in value && typeof value.title === 'string' ? value.title.trim().replace(/\s+/g, ' ').slice(0, 200) : '') || 'Untitled session',
    workingDirectory: value.location.directory,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    archived,
  };
}

export default async function listOpenCodeSessions(command: string): Promise<StoredSession[]> {
  const executable = await resolveExecutable(command, process.env.PATH);
  if (!executable) throw new Error('OpenCode was not found. Install OpenCode or set OPENCODE_BIN to its executable path.');
  const sessions = new Map<string, StoredSession>();
  const deadline = Date.now() + 30000;
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('OpenCode session discovery timed out. Try refreshing the list.');
      const query = new URLSearchParams({ limit: '100', order: 'desc', archived: String(archived) });
      if (cursor !== null) query.set('cursor', cursor);
      let stdout: string;
      try {
        ({ stdout } = await execute(executable, ['api', 'get', `/api/session?${query}`], {
          encoding: 'utf8', timeout: Math.min(15000, remaining), killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
        }));
      } catch {
        throw new Error('Unable to list OpenCode sessions. Check that OpenCode v2 and its local service are available, or set OPENCODE_BIN.');
      }
      let result: unknown;
      try { result = JSON.parse(stdout); } catch {
        throw new Error('OpenCode returned an invalid session list. Check your CLI version.');
      }
      if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)
        || !('cursor' in result) || !result.cursor || typeof result.cursor !== 'object') {
        throw new Error('OpenCode returned an invalid session list. Check your CLI version.');
      }
      const next: unknown = 'next' in result.cursor ? result.cursor.next : null;
      if (next !== null && typeof next !== 'string') throw new Error('OpenCode returned an invalid session cursor.');
      for (const value of result.data) {
        const session = parseSession(value, archived);
        sessions.set(session.id, session);
      }
      cursor = next;
      if (cursor !== null) {
        if (seenCursors.has(cursor)) throw new Error('OpenCode repeated a session-list cursor. Try refreshing.');
        seenCursors.add(cursor);
      }
    } while (cursor !== null);
  }
  return [...sessions.values()];
}
