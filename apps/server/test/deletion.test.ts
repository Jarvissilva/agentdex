import { once } from 'node:events';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import deleteAntigravitySession from '../src/lib/providers/agy/delete.js';
import { deleteOpenCodeSession } from '../src/lib/providers/opencode/sessions.js';
import listCodexSessions from '../src/lib/providers/codex/sessions.js';

const parent = '11111111-1111-1111-1111-111111111111';
const child = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-delete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'history.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, parent_conversation_id TEXT)');
  const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?)');
  insert.run(parent, ''); insert.run(child, parent); insert.run(other, '');
  db.close();
  for (const dir of ['conversations', 'brain', 'annotations', 'presence', 'implicit', 'cache']) await mkdir(path.join(root, dir));
  for (const id of [parent, child, other]) {
    await mkdir(path.join(root, 'brain', id));
    for (const name of [`conversations/${id}.db`, `annotations/${id}.pbtxt`, `presence/${id}.lock`, `implicit/${id}.pb`, `brain/${id}/plan.md`]) await writeFile(path.join(root, name), 'keep private');
  }
  await writeFile(path.join(root, 'cache/last_conversations.json'), JSON.stringify({ '/workspace': parent, '/other': other }));
  await writeFile(path.join(root, 'cache/conversation_metadata.json'), JSON.stringify({ conversations: { [parent]: {}, [child]: {}, [other]: {} } }));
  return { root, file };
}

test('Antigravity removes descendants, presence and caches, preserving unrelated data; retries missing files', async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(path.join(root, 'project.txt'), 'workspace');
  await deleteAntigravitySession(parent, file);
  for (const id of [parent, child]) {
    for (const name of [`conversations/${id}.db`, `brain/${id}`, `annotations/${id}.pbtxt`, `presence/${id}.lock`, `implicit/${id}.pb`]) await assert.rejects(access(path.join(root, name)));
  }
  await access(path.join(root, `conversations/${other}.db`));
  assert.equal(await readFile(path.join(root, 'project.txt'), 'utf8'), 'workspace');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'cache/last_conversations.json'), 'utf8')), { '/other': other });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'cache/conversation_metadata.json'), 'utf8')), { conversations: { [other]: {} } });
  const db = new DatabaseSync(file);
  assert.deepEqual(db.prepare('SELECT conversation_id FROM conversation_summaries').all().map((row) => row.conversation_id), [other]);
  db.close();
  await deleteAntigravitySession(parent, file);
});

test('Antigravity preflights malformed caches, traversal, symlinks and database locks', async (t) => {
  const { root, file } = await fixture(t);
  const cache = path.join(root, 'cache/last_conversations.json');
  await writeFile(cache, '{');
  await assert.rejects(deleteAntigravitySession(parent, file), /retry/);
  await access(path.join(root, `conversations/${parent}.db`));
  await writeFile(cache, '{}');
  await assert.rejects(deleteAntigravitySession('../project', file), /UUID/);
  await symlink(path.join(root, 'project'), path.join(root, 'brain', parent, 'link'));
  await assert.rejects(deleteAntigravitySession(parent, file), /Symlinked/);
  await rm(path.join(root, 'brain', parent, 'link'));
  const db = new DatabaseSync(file); db.exec('BEGIN IMMEDIATE');
  await assert.rejects(deleteAntigravitySession(parent, file), /locked/);
  db.exec('ROLLBACK'); db.close();
  await access(path.join(root, `presence/${parent}.lock`));
  await deleteAntigravitySession(parent, file);
});

test('uses native provider deletion commands with configured executables', async (t) => {
  const { root } = await fixture(t);
  const executable = path.join(root, 'provider');
  await writeFile(executable, `#!${process.execPath}
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['session', 'delete', '${parent}']);
`, { mode: 0o755 });
  await deleteOpenCodeSession(executable, parent);
  await writeFile(executable, `#!${process.execPath}
const readline = require('node:readline');
const assert = require('node:assert/strict');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));
 else if(m.method==='thread/delete') {
 assert.deepEqual(m.params,{threadId:'${parent}'});
 console.log(JSON.stringify({id:m.id,result:{}}));
 } else assert.equal(m.method,'initialized');
});
`, { mode: 0o755 });
  assert.deepEqual(await listCodexSessions(executable, parent), []);
});

test('partial cleanup retains summary records and supports a successful retry', async (t) => {
  const { root, file } = await fixture(t);
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON conversation_summaries BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
  db.close();
  await assert.rejects(deleteAntigravitySession(parent, file), /some local files may already be removed/);
  await assert.rejects(access(path.join(root, `conversations/${parent}.db`)));
  const retry = new DatabaseSync(file);
  assert.equal(retry.prepare('SELECT COUNT(*) AS count FROM conversation_summaries').get()?.count, 3);
  retry.exec('DROP TRIGGER fail_delete'); retry.close();
  await deleteAntigravitySession(parent, file);
  await access(path.join(root, `conversations/${other}.db`));
});

test('Codex surfaces native deletion failures so users can resolve them', async (t) => {
  const { root } = await fixture(t);
  const executable = path.join(root, 'codex');
  for (const error of [
    { code: -32600, message: 'Cannot delete a thread with an active turn.' },
    { code: -32603, message: 'Failed to remove rollout: Permission denied.' },
    { code: -32603 },
    null,
  ]) {
    await writeFile(executable, `#!${process.execPath}
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));
 else if(m.method==='thread/delete') console.log(JSON.stringify({id:m.id,error:${JSON.stringify(error)}}));
});
`, { mode: 0o755 });
    await assert.rejects(listCodexSessions(executable, parent), {
      message: `Codex could not complete the session operation: ${error && 'message' in error ? error.message : 'Check your CLI version and configuration.'}`,
    });
  }
});

test('Antigravity rejects a held descendant presence lock before removing any files', async (t) => {
  if (process.platform !== 'linux') return;
  const { root, file } = await fixture(t);
  const holder = spawn('flock', ['-x', path.join(root, 'presence', child + '.lock'), 'sh', '-c', 'echo ready; cat']);
  t.after(() => { holder.kill(); });
  await once(holder.stdout, 'data');
  await assert.rejects(deleteAntigravitySession(parent, file), { status: 409 });
  await access(path.join(root, 'conversations', parent + '.db'));
  const exited = once(holder, 'exit');
  holder.stdin.end();
  await exited;
  await deleteAntigravitySession(parent, file);
});

test('Codex active writer race is translated to actionable HTTP 409', async (t) => {
  const { root } = await fixture(t);
  const executable = path.join(root, 'codex-active');
  await writeFile(executable, `#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));
 if(m.method==='thread/delete') console.log(JSON.stringify({id:m.id,error:{message:'Thread has an active writer'}}));
});
`, { mode: 0o755 });
  await assert.rejects(listCodexSessions(executable, parent), (error: unknown) => {
    assert(error instanceof Error && 'status' in error && error.status === 409);
    assert.match(error.message, /Close it in Codex/);
    return true;
  });
});
