import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { lockActivity } from '../src/lib/providers/activity.js';
import SessionHistoryService from '../src/services/SessionHistoryService.js';
import ProviderRegistry from '../src/lib/providers/index.js';
import codex from '../src/lib/providers/codex/index.js';
import HttpError from '../src/lib/HttpError.js';
import { codexTaskActivity } from '../src/lib/providers/codex/sessions.js';
import { antigravityTaskActivity } from '../src/lib/providers/agy/sessions.js';
import listCodexSessions from '../src/lib/providers/codex/sessions.js';
import listOpenCodeSessions from '../src/lib/providers/opencode/sessions.js';

test('kernel locks distinguish held, released, stale and missing files; unavailable inspection is unknown', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.lock');
  await writeFile(file, '');
  assert.deepEqual(await lockActivity([file], 'darwin'), ['unknown']);
  assert.deepEqual(await lockActivity([file], 'linux', path.join(root, 'no-proc')), ['unknown']);
  if (process.platform !== 'linux') return;
  assert.deepEqual(await lockActivity([file, path.join(root, 'missing')]), ['inactive', 'inactive']);
  const child = spawn('flock', ['-x', file, 'sh', '-c', 'echo ready; cat'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  await once(child.stdout, 'data');
  assert.deepEqual(await lockActivity([file]), ['active']);
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
  assert.deepEqual(await lockActivity([file]), ['inactive']);
});

test('history deletion rejects active descendants and preserves native HttpError status; unknown remains deletable', async () => {
  let deleted = false;
  const parent = { id: 'parent', title: '', workingDirectory: '', createdAt: null, updatedAt: '', archived: false, activity: 'unknown' as const };
  const child = { ...parent, id: 'child', parentId: 'parent', activity: 'active' as const };
  const registry = new ProviderRegistry([{ ...codex, listSessions: async () => [parent, child], deleteSession: async () => { deleted = true; } }]);
  await assert.rejects(new SessionHistoryService(registry).deleteSession('codex', 'parent'), { status: 409 });
  assert.equal(deleted, false);
  const unknown = new ProviderRegistry([{ ...codex, listSessions: async () => [parent], deleteSession: async () => { deleted = true; } }]);
  await new SessionHistoryService(unknown).deleteSession('codex', 'parent');
  assert.equal(deleted, true);
  const native = new ProviderRegistry([{ ...codex, listSessions: async () => [], deleteSession: async () => { throw new HttpError(409, 'active writer'); } }]);
  await assert.rejects(new SessionHistoryService(native).deleteSession('codex', 'parent'), { status: 409 });
});

test('OpenCode validates configured service activity without losing history on failures', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-active-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, 'opencode');
  for (const [response, expected] of [
    [{ data: { one: { type: 'running' } } }, 'active'],
    [{ data: {} }, 'inactive'],
    [{ data: { other: { type: 'running' } } }, 'inactive'],
    [{ data: [] }, 'unknown'],
    [{ data: { one: { type: 'idle' } } }, 'unknown'],
    [null, 'unknown'],
  ] as const) {
    await writeFile(command, `#!${process.execPath}
if(process.argv[4]==='/api/session/active') { if (${JSON.stringify(response)} === null) process.exit(1); console.log(JSON.stringify(${JSON.stringify(response)})); }
else console.log(JSON.stringify({data:[{id:'one',location:{directory:'/x'},time:{created:1,updated:2}}],cursor:{}}));
`, { mode: 0o755 });
    const sessions = await listOpenCodeSessions(command);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.activity, expected);
  }
});

test('Codex activity uses the configured CODEX_HOME and counts idle held writers as active', async (t) => {
  if (process.platform !== 'linux') return;
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-codex-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.CODEX_HOME;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  process.env.CODEX_HOME = root;
  await mkdir(path.join(root, 'thread-writer-locks'));
  const file = path.join(root, 'thread-writer-locks/first.lock');
  await writeFile(file, '');
  const command = path.join(root, 'codex');
  const fixture = await readFile(new URL('./fixtures/codex-server.mjs', import.meta.url), 'utf8');
  await writeFile(command, fixture.replace('#!/usr/bin/env node', `#!${process.execPath}`), { mode: 0o755 });
  const holder = spawn('flock', ['-x', file, 'sh', '-c', 'echo ready; cat']);
  t.after(() => { holder.kill(); });
  await once(holder.stdout, 'data');
  assert.equal((await listCodexSessions(command)).find((session) => session.id === 'first')?.activity, 'active');
  const rollout = path.join(root, 'rollout.jsonl');
  const event = (type: string) => JSON.stringify({type:'event_msg',payload:{type,turn_id:'turn'}}) + '\n';
  await writeFile(rollout, event('task_started'));
  await writeFile(command, fixture.replace('#!/usr/bin/env node', `#!${process.execPath}`)
    .replace("name: null, preview:", `path: ${JSON.stringify(rollout)}, status: {type:'notLoaded'}, name: null, preview:`), { mode: 0o755 });
  assert.equal((await listCodexSessions(command)).find((session) => session.id === 'first')?.taskActivity, 'running');
  await writeFile(rollout, event('task_started') + event('task_complete'));
  const completed = (await listCodexSessions(command)).find((session) => session.id === 'first');
  assert.equal(completed?.activity, 'active'); // The external CLI still holds its writer lock.
  assert.equal(completed?.taskActivity, 'not-running');

  const exited = once(holder, 'exit');
  holder.stdin.end();
  await exited;
  assert((await listCodexSessions(command)).every((session) => session.activity === 'inactive'));
});

test('Codex consumes explicit runtime status and never treats unloaded history as idle', () => {
  for (const [status, expected] of [
    [{ type: 'active', activeFlags: [] }, 'running'],
    [{ type: 'active', activeFlags: ['waitingOnApproval'] }, 'needs-input'],
    [{ type: 'active', activeFlags: ['waitingOnUserInput'] }, 'needs-input'],
    [{ type: 'idle' }, 'not-running'],
    [{ type: 'notLoaded' }, 'unknown'],
    [{ type: 'systemError' }, 'unknown'],
    [{ type: 'active', activeFlags: ['future-flag'] }, 'unknown'],
    [null, 'unknown'],
  ] as const) assert.equal(codexTaskActivity(status), expected);
});

test('Antigravity uses explicit summary states only while presence is live', () => {
  for (const [status, expected] of [
    ['CASCADE_RUN_STATUS_RUNNING', 'running'], ['CASCADE_RUN_STATUS_BUSY', 'running'],
    ['CASCADE_RUN_STATUS_CANCELING', 'running'], ['CASCADE_RUN_STATUS_IDLE', 'not-running'],
    ['', 'unknown'], ['future-state', 'unknown'],
  ] as const) {
    assert.equal(antigravityTaskActivity(status, 'active', 0), expected);
    assert.equal(antigravityTaskActivity(status, 'inactive', 0), 'unknown');
    assert.equal(antigravityTaskActivity(status, 'unknown', 0), 'unknown');
    assert.equal(antigravityTaskActivity(status, 'active', 1), 'unknown');
  }
});

test('OpenCode pending permission requests become Needs input without affecting other sessions', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-input-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, 'opencode');
  await writeFile(command, `#!${process.execPath}
const endpoint = process.argv[4];
if (endpoint === '/api/session/active') console.log(JSON.stringify({data:{one:{type:'running'}}}));
else if (endpoint === '/api/permission/request') console.log(JSON.stringify({data:[{sessionID:'one'},{sessionID:'unlisted'}]}));
else console.log(JSON.stringify({data:['one','two'].map(id=>({id,location:{directory:'/x'},time:{created:1,updated:2}})),cursor:{}}));
`, { mode: 0o755 });
  const sessions = await listOpenCodeSessions(command);
  assert.equal(sessions.find((session) => session.id === 'one')?.taskActivity, 'needs-input');
  assert.equal(sessions.find((session) => session.id === 'one')?.activity, 'active');
  assert.equal(sessions.find((session) => session.id === 'two')?.taskActivity, 'not-running');
});
