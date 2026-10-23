import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import ProviderRegistry from '../src/lib/providers/index.js';
import agy from '../src/lib/providers/agy/index.js';
import opencode from '../src/lib/providers/opencode/index.js';
import listAntigravitySessions from '../src/lib/providers/agy/sessions.js';
import listOpenCodeSessions from '../src/lib/providers/opencode/sessions.js';

test('registers all three providers and retains Codex as the default', () => {
  const registry = new ProviderRegistry();
  assert.deepEqual(registry.list(), [
    { id: 'codex', name: 'Codex' },
    { id: 'agy', name: 'Antigravity CLI' },
    { id: 'opencode', name: 'OpenCode' },
  ]);
  assert.equal(registry.get().id, 'codex');
  assert.deepEqual(agy.getLaunchConfig('/project').args, []);
  assert.deepEqual(opencode.getLaunchConfig('/project').args, []);
});

test('provider executable overrides are read when launching', () => {
  const previousAgy = process.env.AGY_BIN;
  const previousOpenCode = process.env.OPENCODE_BIN;
  try {
    process.env.AGY_BIN = '/custom/agy';
    process.env.OPENCODE_BIN = '/custom/opencode';
    assert.equal(agy.getLaunchConfig('/project').executable, '/custom/agy');
    assert.equal(opencode.getLaunchConfig('/project').executable, '/custom/opencode');
  } finally {
    if (previousAgy === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = previousAgy;
    if (previousOpenCode === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = previousOpenCode;
  }
});

test('Antigravity lists all workspace summaries without changing its database', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-agy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'summaries.db');
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, preview TEXT, last_modified_time TEXT, workspace_uris TEXT)');
  const insert = database.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)');
  insert.run('one', ' First\n title ', 'preview', '2026-08-18 09:30:31.040646154+00:00', JSON.stringify(['file:///outside/first%20project', 'file:///outside/second']));
  insert.run('two', '', 'Fallback preview', '2026-08-19 09:30:31+00:00', JSON.stringify(['file:///another/project']));
  insert.run('three', '', '', '2026-08-20 09:30:31+00:00', '');
  insert.run('four', 'No workspace', '', '2026-08-21 09:30:31+00:00', 'null');
  database.close();
  const before = await readFile(file);
  const sessions = await listAntigravitySessions(file);
  assert.equal(sessions.length, 4);
  assert.equal(sessions[0]?.title, 'First title');
  assert.equal(sessions[0]?.workingDirectory, '/outside/first project');
  assert.equal(sessions[0]?.updatedAt, '2026-08-18T09:30:31.040Z');
  assert.equal(sessions[0]?.createdAt, null);
  assert.equal(sessions[1]?.title, 'Fallback preview');
  assert.equal(sessions[1]?.workingDirectory, '/another/project');
  assert.equal(sessions[2]?.title, 'Untitled session');
  assert.equal(sessions[2]?.workingDirectory, '');
  assert.equal(sessions[3]?.workingDirectory, '');
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await listAntigravitySessions(path.join(directory, 'missing.db')), []);
});

test('Antigravity reports incompatible schemas and corrupt metadata', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-agy-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'invalid.db');
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE incompatible (id TEXT)');
  database.close();
  await assert.rejects(listAntigravitySessions(file), /database format may have changed/);
});

test('OpenCode reads all global pages, child sessions and archives without directory filters', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-opencode-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'opencode');
  await writeFile(command, `#!${process.execPath}
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2, 4), ['api', 'get']);
const url = new URL(process.argv[4], 'http://localhost');
assert.equal(url.pathname, '/api/session');
for (const key of ['directory', 'project', 'parentID']) assert.equal(url.searchParams.has(key), false);
const archived = url.searchParams.get('archived') === 'true';
const cursor = url.searchParams.get('cursor');
const session = (id, extra = {}) => ({ id, title: 'Session '+id, location: {directory: '/outside/'+id}, time: {created: 1700000000000, updated: 1700000001000}, ...extra });
let result;
if (archived) result = {data: [session('archive')], cursor: {next: null}};
else if (!cursor) result = {data: [session('parent')], cursor: {next: 'opaque+/=cursor'}};
else {
assert.equal(cursor, 'opaque+/=cursor');
result = {data: [session('child', {parentID:'parent', title:null}), session('parent')], cursor: {}};
}
console.log(JSON.stringify(result));
`, { mode: 0o755 });
  const sessions = await listOpenCodeSessions(command);
  assert.deepEqual(sessions.map((session) => session.id), ['parent', 'child', 'archive']);
  assert.equal(sessions[1]?.title, 'Untitled session');
  assert.equal(sessions[1]?.workingDirectory, '/outside/child');
  assert.equal(sessions[0]?.createdAt, '2023-11-14T22:13:20.000Z');
  assert.equal(sessions[2]?.archived, true);
});

test('OpenCode reports missing executables, invalid JSON and repeated cursors', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-opencode-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(listOpenCodeSessions(path.join(directory, 'missing')), /OPENCODE_BIN/);
  const command = path.join(directory, 'opencode');
  await writeFile(command, `#!${process.execPath}\nconsole.log('not JSON');\n`, { mode: 0o755 });
  await assert.rejects(listOpenCodeSessions(command), /invalid session list/);
  await writeFile(command, `#!${process.execPath}\nconsole.log(JSON.stringify({data:[],cursor:{next:'same'}}));\n`, { mode: 0o755 });
  await assert.rejects(listOpenCodeSessions(command), /repeated a session-list cursor/);
});
