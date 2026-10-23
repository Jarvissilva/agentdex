import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { StoredSession } from '@agentdex/shared';
import ProviderRegistry from '../src/lib/providers/index.js';
import codex from '../src/lib/providers/codex/index.js';
import agy from '../src/lib/providers/agy/index.js';
import opencode from '../src/lib/providers/opencode/index.js';
import type { ProviderAdapter } from '../src/lib/providers/types.js';
import HttpError from '../src/lib/HttpError.js';
import SessionService from '../src/services/SessionService.js';

const saved: StoredSession = {
  id: 'saved-session', title: 'Continue this conversation', workingDirectory: '/missing-resume-directory',
  activity: 'unknown', archived: false, createdAt: null, updatedAt: '2026-10-23T00:00:00.000Z',
};
const fixture = fileURLToPath(new URL('./fixtures/terminal.mjs', import.meta.url));
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
const service = (adapter: ProviderAdapter) => new SessionService(new ProviderRegistry([adapter]));

test('resume configurations use explicit saved IDs and configured provider executables', () => {
  for (const [provider, args] of [[codex, ['resume', saved.id]], [agy, ['--conversation', saved.id]], [opencode, ['--session', saved.id]]] as const) {
    const config = provider.getResumeConfig!('/project', saved.id);
    assert.deepEqual(config.args, args);
    assert.equal(config.executable, provider.getLaunchConfig('/project').executable);
    assert.deepEqual(provider.getLaunchConfig('/project').args, []);
  }
});

test('resume rejects malformed IDs, absent history, unsupported providers and discovery failures', async () => {
  const sessions = service({ ...codex, listSessions: async () => [] });
  for (const id of ['', '--last', '../session', null, 42]) await assert.rejects(sessions.create('/tmp', 'codex', id), status(400));
  await assert.rejects(sessions.create('/tmp', 'codex', saved.id), status(404));
  const unsupported = service({ ...codex, getResumeConfig: undefined });
  await assert.rejects(unsupported.create('/tmp', 'codex', saved.id), /does not support resuming/);
  const broken = service({ ...codex, listSessions: async () => { throw new Error('Discovery failed'); } });
  await assert.rejects(broken.create('/tmp', 'codex', saved.id), status(502));
});

test('resume uses the saved directory rather than the request directory', async () => {
  const missingDirectory = service({ ...codex, listSessions: async () => [saved] });
  await assert.rejects(missingDirectory.create('/tmp', 'codex', saved.id), /does not exist or is not accessible/);
  const noDirectory = service({ ...codex, listSessions: async () => [{ ...saved, workingDirectory: '' }] });
  await assert.rejects(noDirectory.create('/tmp', 'codex', saved.id), /Enter a working directory/);
});

test('pending resumes coalesce, block deletion, and release the guard after failure', async () => {
  let finish!: (sessions: StoredSession[]) => void;
  let discoveries = 0;
  const sessions = service({ ...codex, listSessions: () => { discoveries++; return new Promise((resolve) => { finish = resolve; }); } });
  const first = sessions.create('/tmp', 'codex', saved.id);
  const second = sessions.create('/tmp', 'codex', saved.id);
  await assert.rejects(sessions.deleteHistory('codex', async () => { assert.fail('Deletion must be blocked'); }), status(409));
  finish([]);
  await Promise.all([assert.rejects(first, status(404)), assert.rejects(second, status(404))]);
  assert.equal(discoveries, 1);
  let deleted = false;
  await sessions.deleteHistory('codex', async () => { deleted = true; });
  assert.equal(deleted, true);
});

for (const activity of ['active', 'inactive', 'unknown'] as const) {
  test(`${activity} archived sessions resume once, reuse the running terminal, and resume again after exit`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-resume-'));
    let launches = 0;
    const sessions = service({
      ...codex,
      listSessions: async () => [{ ...saved, workingDirectory: directory, activity, archived: true }],
      getResumeConfig: (cwd, id) => {
        assert.equal(cwd, directory);
        assert.equal(id, saved.id);
        launches++;
        return { executable: process.execPath, args: [fixture] };
      },
    });
    t.after(async () => { sessions.shutdown(); await rm(directory, { recursive: true, force: true }); });
    const [first, second] = await Promise.all([sessions.create('/ignored', 'codex', saved.id), sessions.create('/ignored', 'codex', saved.id)]);
    assert.equal(first.id, second.id);
    assert.equal(first.providerSessionId, saved.id);
    assert.equal(first.workingDirectory, await realpath(directory));
    assert.equal(launches, 1);
    assert.equal((await sessions.create('/ignored', 'codex', saved.id)).id, first.id);
    await assert.rejects(sessions.deleteHistory('codex', async () => {}), status(409));
    const runtime = sessions.getRuntime(first.id);
    const exited = new Promise<void>((resolve) => runtime.events.once('exit', () => resolve()));
    sessions.stop(first.id);
    await exited;
    const restarted = await sessions.create('/ignored', 'codex', saved.id);
    assert.notEqual(restarted.id, first.id);
    assert.equal(launches, 2);
  });
}
