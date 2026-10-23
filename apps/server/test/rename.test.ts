import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { StoredSession } from '@agentdex/shared';
import codex from '../src/lib/providers/codex/index.js';
import listCodexSessions from '../src/lib/providers/codex/sessions.js';
import { renameOpenCodeSession } from '../src/lib/providers/opencode/sessions.js';
import { renameAntigravitySession } from '../src/lib/providers/agy/sessions.js';
import ProviderRegistry from '../src/lib/providers/index.js';
import SessionHistoryService from '../src/services/SessionHistoryService.js';

const saved: StoredSession = {
  id: 'saved-session', title: 'Original title', workingDirectory: '/project',
  activity: 'active', archived: false, createdAt: null, updatedAt: '2026-10-23T00:00:00.000Z',
};

test('renaming persists provider titles across rediscovery for every activity state and isolates colliding IDs', async () => {
  for (const activity of ['active', 'inactive', 'unknown'] as const) {
    let title = saved.title;
    const history = new SessionHistoryService(new ProviderRegistry([
      { ...codex, listSessions: async () => [{ ...saved, title, activity }], renameSession: async (id, value) => { assert.equal(id, saved.id); title = value; } },
      { ...codex, id: 'other', listSessions: async () => [saved], renameSession: async () => assert.fail('Wrong provider') },
    ]));
    await history.renameSession('codex', saved.id, '  New title ✨  ');
    const sessions = (await history.list()).sessions;
    assert.equal(sessions.find((session) => session.provider === 'codex')?.title, 'New title ✨');
    assert.equal(sessions.find((session) => session.provider === 'other')?.title, saved.title);
  }
});

test('rename validates titles, IDs and providers and reports missing sessions or provider failures', async () => {
  let calls = 0;
  const history = new SessionHistoryService(new ProviderRegistry([{
    ...codex, listSessions: async () => [saved], renameSession: async () => { calls++; throw new Error('Provider refused rename'); },
  }]));
  for (const title of [undefined, null, 42, '', '  ', 'a'.repeat(201), 'two\nlines', 'escape\x1b']) {
    await assert.rejects(history.renameSession('codex', saved.id, title), { status: 400 });
  }
  await assert.rejects(history.renameSession('codex', '../session', 'Title'), { status: 400 });
  await assert.rejects(history.renameSession('missing', saved.id, 'Title'), { status: 400 });
  await assert.rejects(history.renameSession('codex', 'missing', 'Title'), { status: 404 });
  assert.equal(calls, 0);
  await assert.rejects(history.renameSession('codex', saved.id, 'Valid title'), { status: 502, message: 'Provider refused rename' });
});

test('Codex and OpenCode use native rename operations with exact titles and surface failures', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-rename-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'provider');
  const title = 'Title with "quotes", $() and ✨';
  await writeFile(executable, `#!${process.execPath}
const assert = require('node:assert/strict');
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const message = JSON.parse(line);
 if (message.method === 'initialize') console.log(JSON.stringify({id:message.id,result:{}}));
 else if (message.method === 'thread/name/set') {
   assert.deepEqual(message.params, {threadId:'${saved.id}',name:${JSON.stringify(title)}});
   console.log(JSON.stringify({id:message.id,result:{}}));
 } else assert.equal(message.method,'initialized');
});
`, { mode: 0o755 });
  assert.deepEqual(await listCodexSessions(executable, saved.id, title), []);
  await writeFile(executable, `#!${process.execPath}
require('node:assert/strict').deepEqual(process.argv.slice(2), ['api','post','/api/session/${saved.id}/rename','--data',${JSON.stringify(JSON.stringify({ title }))}]);
`, { mode: 0o755 });
  await renameOpenCodeSession(executable, saved.id, title);
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
  await assert.rejects(renameOpenCodeSession(executable, saved.id, title), /Unable to rename/);
  await assert.rejects(listCodexSessions(executable, saved.id, title), /exited before completing/);
});

test('Antigravity updates only the matching title and leaves other metadata and rows intact', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-rename-agy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'history.db');
  const database = new DatabaseSync(file);
  t.after(() => database.close());
  database.exec('CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, last_modified_time TEXT)');
  database.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run(saved.id, saved.title, 'Private preview', '2026-10-23');
  database.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('other', 'Other', 'Other preview', '2026-10-22');
  await renameAntigravitySession(saved.id, 'Updated title', file);
  assert.deepEqual({ ...database.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?').get(saved.id) }, {
    conversation_id: saved.id, title: 'Updated title', preview: 'Private preview', last_modified_time: '2026-10-23',
  });
  assert.equal(database.prepare('SELECT title FROM conversation_summaries WHERE conversation_id = ?').get('other')?.title, 'Other');
  await assert.rejects(renameAntigravitySession('missing', 'Title', file), { status: 404 });
  const absent = path.join(directory, 'absent.db');
  await assert.rejects(renameAntigravitySession(saved.id, 'Title', absent));
  await assert.rejects(readFile(absent), { code: 'ENOENT' });
});
