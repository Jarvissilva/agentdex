import HttpError from '../../HttpError.js';
import { lockActivity, rejectActive } from '../activity.js';
import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let queue: Promise<void> = Promise.resolve();

async function inspect(target: string, recursive = false): Promise<boolean> {
  // Check every ancestor as well as the target; never follow links during cleanup.
  const parent = path.dirname(target);
  if (parent !== target && !await inspect(parent)) return false;
  let info;
  try { info = await lstat(target); } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error('Symlinked Antigravity cleanup targets are not supported.');
  if (recursive && info.isDirectory()) {
    for (const name of await readdir(target)) await inspect(path.join(target, name), true);
  }
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function removeSession(id: string, databasePath: string): Promise<void> {
  if (!uuid.test(id)) throw new Error('Invalid Antigravity conversation UUID.');
  const file = path.resolve(databasePath);
  const root = path.dirname(file);
  if (!await inspect(file)) throw new Error('Antigravity history database is missing.');
  for (const suffix of ['-wal', '-shm', '-journal']) await inspect(file + suffix);
  const database = new DatabaseSync(file);
  let transaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    transaction = true;
    const rows = database.prepare('SELECT conversation_id, parent_conversation_id FROM conversation_summaries').all();
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (typeof row.parent_conversation_id === 'string' && ids.has(row.parent_conversation_id)) {
          if (typeof row.conversation_id !== 'string' || !uuid.test(row.conversation_id)) throw new Error('Invalid child conversation UUID.');
          if (!ids.has(row.conversation_id)) { ids.add(row.conversation_id); changed = true; }
        }
      }
    }
    const checkActivity = async () => rejectActive((await lockActivity([...ids].map((entry) => path.join(root, 'presence', `${entry}.lock`)))).map((activity) => ({ activity })));
    await checkActivity();
    const targets: string[] = [];
    for (const entry of ids) {
      for (const relative of [`conversations/${entry}.db`, `conversations/${entry}.db-wal`, `conversations/${entry}.db-shm`, `conversations/${entry}.db-journal`, `brain/${entry}`, `annotations/${entry}.pbtxt`, `presence/${entry}.lock`, `implicit/${entry}.pb`]) {
        const target = path.join(root, relative);
        await inspect(target, true);
        targets.push(target);
      }
    }
    const caches: { file: string; content: string }[] = [];
    for (const name of ['last_conversations.json', 'conversation_metadata.json']) {
      const cache = path.join(root, 'cache', name);
      if (!await inspect(cache)) continue;
      const value: unknown = JSON.parse(await readFile(cache, 'utf8'));
      if (!record(value)) throw new Error(`Unsupported ${name} format.`);
      if (name === 'last_conversations.json') {
        for (const [key, entry] of Object.entries(value)) {
          if (typeof entry !== 'string') throw new Error(`Unsupported ${name} format.`);
          if (ids.has(entry)) delete value[key];
        }
      } else {
        if (!record(value.conversations)) throw new Error(`Unsupported ${name} format.`);
        for (const entry of Object.values(value.conversations)) {
          if (!record(entry)) throw new Error(`Unsupported ${name} format.`);
        }
        for (const entry of ids) delete value.conversations[entry];
      }
      caches.push({ file: cache, content: JSON.stringify(value, null, 2) + '\n' });
    }
    // All formats and targets have passed preflight before any content is removed.
    await checkActivity();
    for (const target of targets) {
      await inspect(target, true);
      await rm(target, { recursive: true, force: true });
    }
    for (const cache of caches) {
      const temporary = `${cache.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, cache.content, { flag: 'wx', mode: 0o600 });
        await inspect(cache.file);
        await rename(temporary, cache.file);
      } finally { await rm(temporary, { force: true }); }
    }
    const remove = database.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?');
    for (const entry of ids) remove.run(entry);
    database.exec('COMMIT');
    transaction = false;
  } catch (error) {
    if (transaction) database.exec('ROLLBACK');
    if (error instanceof HttpError) throw error;
    throw new Error(`Antigravity deletion did not complete; some local files may already be removed. Stop external sessions and retry. ${error instanceof Error ? error.message : 'Cleanup failed.'}`, { cause: error });
  } finally { database.close(); }
}

export default function deleteAntigravitySession(id: string, databasePath = process.env.AGY_HISTORY_DB || path.join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db')): Promise<void> {
  const operation = queue.then(() => removeSession(id, databasePath));
  queue = operation.catch(() => {});
  return operation;
}
