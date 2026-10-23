import HttpError from '../../HttpError.js';
import { lockActivity } from '../activity.js';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Session, StoredSession } from '@agentdex/shared';

export function antigravityTaskActivity(status: unknown, presence: StoredSession['activity'], killed: unknown): Session['taskActivity'] {
  // Persisted summaries may outlive the process that produced them.
  if (presence !== 'active' || killed === 1) return 'unknown';
  if (status === 'CASCADE_RUN_STATUS_IDLE') return 'not-running';
  if (status === 'CASCADE_RUN_STATUS_RUNNING' || status === 'CASCADE_RUN_STATUS_BUSY' || status === 'CASCADE_RUN_STATUS_CANCELING') return 'running';
  return 'unknown';
}

function workspaceDirectory(value: string): string {
  if (!value.trim()) return '';
  const uris: unknown = JSON.parse(value);
  if (uris === null) return '';
  if (!Array.isArray(uris) || !uris.every((uri: unknown) => typeof uri === 'string')) {
    throw new Error('Invalid workspace metadata.');
  }
  for (const uri of uris) {
    if (uri.startsWith('file:')) return fileURLToPath(uri);
  }
  return '';
}

export default async function listAntigravitySessions(
  databasePath = process.env.AGY_HISTORY_DB || path.join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
): Promise<StoredSession[]> {
  try { await access(databasePath); } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw new Error('Antigravity history is not accessible. Check AGY_HISTORY_DB and file permissions.', { cause: error });
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare('SELECT * FROM conversation_summaries').all();
    const activity = await lockActivity(rows.map((row) => path.join(path.dirname(databasePath), `presence/${row.conversation_id}.lock`)));
    return rows.map((row, index) => {
      if (typeof row.conversation_id !== 'string' || !row.conversation_id
        || typeof row.title !== 'string' || typeof row.preview !== 'string'
        || typeof row.last_modified_time !== 'string' || typeof row.workspace_uris !== 'string') {
        throw new Error('Invalid conversation metadata.');
      }
      return {
        id: row.conversation_id,
        ...(typeof row.parent_conversation_id === 'string' && row.parent_conversation_id ? { parentId: row.parent_conversation_id } : {}),
        title: (row.title.trim() || row.preview.trim() || 'Untitled session').replace(/\s+/g, ' ').slice(0, 200),
        workingDirectory: workspaceDirectory(row.workspace_uris),
        createdAt: null,
        updatedAt: new Date(row.last_modified_time.replace(' ', 'T')).toISOString(),
        activity: activity[index]!,
        taskActivity: antigravityTaskActivity(row.status, activity[index]!, row.killed),
        archived: false,
      };
    });
  } catch {
    throw new Error('Unable to read Antigravity history. Check AGY_HISTORY_DB; the CLI database format may have changed.');
  } finally {
    database?.close();
  }
}

export async function renameAntigravitySession(
  id: string,
  title: string,
  databasePath = process.env.AGY_HISTORY_DB || path.join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
): Promise<void> {
  // Do not create a database when the configured history is missing.
  await access(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    const result = database.prepare('UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?').run(title, id);
    if (!result.changes) throw new HttpError(404, 'Saved session not found. Refresh the sessions explorer.');
  } finally { database.close(); }
}
