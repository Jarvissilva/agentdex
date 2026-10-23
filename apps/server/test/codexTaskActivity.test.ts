import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { codexRolloutActivity } from '../src/lib/providers/codex/taskActivity.js';

const event = (type: string, turn_id = 'root', root_turn_id = turn_id) => JSON.stringify({ type: 'event_msg', payload: { type, turn_id, root_turn_id } }) + '\n';

test('external Codex transitions to Ready on completion and cancellation while its CLI stays open', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-codex-task-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout.jsonl');
  await writeFile(file, event('task_started'));
  assert.equal(await codexRolloutActivity(file), 'running');
  await appendFile(file, event('task_complete'));
  assert.equal(await codexRolloutActivity(file), 'not-running');
  await appendFile(file, event('task_started', 'next'));
  assert.equal(await codexRolloutActivity(file), 'running');
  await appendFile(file, event('turn_aborted', 'next'));
  assert.equal(await codexRolloutActivity(file), 'not-running');
});

test('child events, unrelated output, malformed and partial writes do not overwrite root activity', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdex-codex-tail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout.jsonl');
  await writeFile(file, event('task_started') + event('task_complete', 'child', 'root') + '{bad json}\n' + event('token_count') + event('task_complete').trim());
  assert.equal(await codexRolloutActivity(file), 'running');
  await appendFile(file, '\n');
  assert.equal(await codexRolloutActivity(file), 'not-running');
  await writeFile(file, 'x'.repeat(1024 * 1024 + 100) + '\n' + event('task_complete'));
  assert.equal(await codexRolloutActivity(file), 'not-running');
  await writeFile(file, event('token_count'));
  assert.equal(await codexRolloutActivity(file), 'unknown');
  assert.equal(await codexRolloutActivity(path.join(root, 'missing')), 'unknown');
});
