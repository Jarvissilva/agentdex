import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { StoredSession } from '@agentdex/shared';

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
    const rows = database.prepare('SELECT conversation_id, title, preview, last_modified_time, workspace_uris FROM conversation_summaries').all();
    return rows.map((row) => {
      if (typeof row.conversation_id !== 'string' || !row.conversation_id
        || typeof row.title !== 'string' || typeof row.preview !== 'string'
        || typeof row.last_modified_time !== 'string' || typeof row.workspace_uris !== 'string') {
        throw new Error('Invalid conversation metadata.');
      }
      return {
        id: row.conversation_id,
        title: (row.title.trim() || row.preview.trim() || 'Untitled session').replace(/\s+/g, ' ').slice(0, 200),
        workingDirectory: workspaceDirectory(row.workspace_uris),
        createdAt: null,
        updatedAt: new Date(row.last_modified_time.replace(' ', 'T')).toISOString(),
        archived: false,
      };
    });
  } catch {
    throw new Error('Unable to read Antigravity history. Check AGY_HISTORY_DB; the CLI database format may have changed.');
  } finally {
    database?.close();
  }
}
