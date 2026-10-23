import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import type { ProvidersResponse, Session, SessionsResponse, TerminalServerMessage } from '@agentdex/shared';
import createApp from '../src/app.js';
import SettingsService from '../src/services/SettingsService.js';
import SessionService from '../src/services/SessionService.js';
import ProviderRegistry from '../src/lib/providers/index.js';
import codex from '../src/lib/providers/codex/index.js';
import type { ProviderAdapter } from '../src/lib/providers/types.js';

const origin = 'http://127.0.0.1:5173';
const fixture = fileURLToPath(new URL('./fixtures/terminal.mjs', import.meta.url));
const fixtureProvider: ProviderAdapter = {
  ...codex,
  listSessions: async () => [],
  getLaunchConfig: () => ({ executable: process.execPath, args: [fixture] }),
};

function send(url: string, method: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(JSON.stringify(body))) }) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const resultHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          resultHeaders.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: resultHeaders }));
      });
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function setup(adapters: ProviderAdapter[] = [fixtureProvider]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-test-'));
  const providers = new ProviderRegistry(adapters);
  const settings = new SettingsService(path.join(directory, 'settings.json'), directory);
  const sessions = new SessionService(providers, settings);
  const app = createApp({ providers, sessions, settings, allowedOrigins: [origin], defaultWorkingDirectory: directory });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  // Requests model Vite's same-origin proxy, preserving the browser Host.
  const headers: Record<string, string> = { Host: new URL(origin).host, Origin: origin };
  const first = await send(`${base}/api/sessions`, 'GET', headers);
  assert.equal(first.status, 200);
  headers.Cookie = first.headers.getSetCookie()[0]!.split(';')[0]!;
  const request = (endpoint: string, method = 'GET', body?: unknown, customHeaders = headers) => send(
    `${base}/api${endpoint}`, method, { ...customHeaders, 'Content-Type': 'application/json' }, body,
  );
  return {
    directory, sessions, headers, request, base,
    cleanup: async () => { app.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); },
  };
}

function connect(base: string, id: string, headers: Record<string, string>) {
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/sessions/${id}/terminal`, { headers });
  const messages: TerminalServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as TerminalServerMessage));
  return { socket, messages };
}

async function waitFor(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for terminal state.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function output(messages: TerminalServerMessage[]) {
  return messages.map((message) => message.type === 'snapshot' || message.type === 'output' ? message.data : '').join('');
}

test('launch, terminal input, resize, replay, exit and relaunch', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  const created = await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  assert.equal(created.status, 201);
  const session = await created.json() as Session;
  assert.equal(session.provider, 'codex');
  assert.equal(session.workingDirectory, context.directory);
  const first = connect(context.base, session.id, context.headers);
  await waitFor(() => output(first.messages).includes(`READY ${context.directory}`));
  assert.equal(first.messages[0]?.type, 'snapshot');
  if (first.messages[0]?.type === 'snapshot') {
    assert.equal(first.messages[0].cols, 120);
    assert.equal(first.messages[0].rows, 32);
  }
  first.socket.send(JSON.stringify({ type: 'input', data: 'hello' }));
  await waitFor(() => output(first.messages).includes('INPUT hello'));
  first.socket.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
  await waitFor(() => output(first.messages).includes('SIZE 90x28'));
  assert.equal(context.sessions.getRuntime(session.id).terminal.cols, 90);
  assert.equal(context.sessions.getRuntime(session.id).terminal.rows, 28);
  first.socket.close();
  await once(first.socket, 'close');
  assert.equal(context.sessions.session?.status, 'running');
  const second = connect(context.base, session.id, context.headers);
  await waitFor(() => output(second.messages).includes('INPUT hello'));
  assert.equal(second.messages[0]?.type, 'snapshot');
  if (second.messages[0]?.type === 'snapshot') {
    assert.equal(second.messages[0].cols, 90);
    assert.equal(second.messages[0].rows, 28);
  }
  second.socket.send(JSON.stringify({ type: 'input', data: 'quit' }));
  await waitFor(() => second.messages.some((message) => message.type === 'exit' && message.session.exitCode === 7));
  const replay = connect(context.base, session.id, context.headers);
  await waitFor(() => replay.messages.some((message) => message.type === 'snapshot' && message.session.status === 'exited'));
  const restarted = await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  assert.equal(restarted.status, 201);
  assert.notEqual((await restarted.json() as Session).id, session.id);
});

test('answers startup color queries without a browser and preserves input background on reconnect', async (t) => {
  const context = await setup([{
    ...fixtureProvider,
    getLaunchConfig: () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/terminal-colors.mjs', import.meta.url))] }),
  }]);
  t.after(context.cleanup);
  const inheritedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  let session: Session;
  try { session = await context.sessions.create(context.directory, 'codex'); }
  finally {
    if (inheritedNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = inheritedNoColor;
  }
  const runtime = context.sessions.getRuntime(session.id);
  // No WebSocket exists yet: startup probes must not depend on a browser reply.
  await waitFor(() => runtime.serializer.serialize().includes('COLOR_READY'));
  const snapshot = runtime.serializer.serialize();
  assert.match(snapshot, /COLOR_ENABLED true/);
  assert.match(snapshot, /COLOR 10 ecec\/ecec\/eeee/);
  assert.match(snapshot, /COLOR 11 1010\/1111\/1313/);
  assert.match(snapshot, /COLOR 12 ecec\/ecec\/eeee/);
  const inputLine = Array.from({ length: runtime.terminal.buffer.active.length }, (_, index) => runtime.terminal.buffer.active.getLine(index))
    .find((line) => line?.translateToString(true).includes('INPUT BAR'));
  assert.equal(inputLine?.getCell(0)?.getBgColor(), 0x28292b);
  assert.equal(inputLine?.getCell(0)?.isBgRGB(), true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = connect(context.base, session.id, context.headers);
    await waitFor(() => client.messages.some((message) => message.type === 'snapshot'));
    const replay = client.messages[0];
    assert(replay?.type === 'snapshot');
    assert.match(replay.data, /48;2;40;41;43/);
    assert.match(replay.data, /INPUT BAR/);
    client.socket.close();
    await once(client.socket, 'close');
  }
});

test('restores SGR mouse encoding in snapshots and forwards binary mouse input', async (t) => {
  const context = await setup([{
    ...fixtureProvider,
    getLaunchConfig: () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/terminal-mouse.mjs', import.meta.url))] }),
  }]);
  t.after(context.cleanup);
  const session = await context.sessions.create(context.directory, 'codex');
  const runtime = context.sessions.getRuntime(session.id);
  await waitFor(() => runtime.terminal.buffer.active.getLine(0)?.translateToString(true).includes('MOUSE_READY') ?? false);
  assert.equal(runtime.mouseEncoding(), '\x1b[?1006h');
  const serialized = runtime.serializer.serialize();
  // SerializeAddon restores tracking but never the encoding, so the snapshot
  // must append it or clicks and wheel events arrive in the legacy binary form.
  assert.ok(serialized.includes('\x1b[?1002h'));
  assert.ok(!serialized.includes('\x1b[?1006h'));

  for (let attempt = 0; attempt < 2; attempt++) {
    const client = connect(context.base, session.id, context.headers);
    await waitFor(() => client.messages.some((message) => message.type === 'snapshot'));
    const snapshot = client.messages[0];
    assert(snapshot?.type === 'snapshot');
    assert.ok(snapshot.data.includes('\x1b[?1002h'));
    assert.ok(snapshot.data.includes('\x1b[?1006h'));
    if (attempt === 0) {
      // Legacy X10 mouse reports arrive as latin-1 bytes through xterm's
      // onBinary path and must reach the PTY unchanged.
      const report = String.fromCharCode(0x1b, 0x5b, 0x4d, 0x20, 0xa0, 0xc8);
      client.socket.send(JSON.stringify({ type: 'input', data: report, encoding: 'binary' }));
      await waitFor(() => output(client.messages).includes('BYTES 1b 5b 4d 20 a0 c8'));
    }
    client.socket.close();
    await once(client.socket, 'close');
  }
});

test('validates directories, supports concurrent launches, and stops each session', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  for (const workingDirectory of ['', 'relative/path', '/does-not-exist-agentdex', 123, null]) {
    assert.equal((await context.request('/sessions', 'POST', { workingDirectory })).status, 400);
  }
  const file = path.join(context.directory, 'file');
  await writeFile(file, 'not a directory');
  assert.equal((await context.request('/sessions', 'POST', { workingDirectory: file })).status, 400);
  const responses = await Promise.all([1, 2].map(() => context.request('/sessions', 'POST', { workingDirectory: context.directory })));
  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  const created = await Promise.all(responses.map((response) => response.json() as Promise<Session>));
  assert.notEqual(created[0]!.id, created[1]!.id);
  const listed = await (await context.request('/sessions')).json() as SessionsResponse;
  assert.deepEqual(new Set(listed.managedSessions.map((session) => session.id)), new Set(created.map((session) => session.id)));
  for (const session of created) {
    const stopped = await context.request(`/sessions/${session.id}`, 'DELETE');
    assert.equal(stopped.status, 202);
    assert.equal(((await stopped.json()) as { session: Session }).session.id, session.id);
    await waitFor(() => context.sessions.getRuntime(session.id).info.status === 'exited');
  }
  assert.equal((await context.request('/sessions/missing', 'DELETE')).status, 404);
});

test('missing executable reports an actionable error', async (t) => {
  const context = await setup([{ ...fixtureProvider, getLaunchConfig: () => ({ executable: '/not-an-agentdex-executable', args: [] }) }]);
  t.after(context.cleanup);
  const response = await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /CODEX_BIN/);
  assert.equal(context.sessions.session, null);
});

test('multiple provider terminals isolate input, reconnect snapshots, and stopping', async (t) => {
  const context = await setup([fixtureProvider, { ...fixtureProvider, id: 'other', name: 'Other' }]);
  t.after(context.cleanup);
  const firstSession = await (await context.request('/sessions', 'POST', { provider: 'codex', workingDirectory: context.directory })).json() as Session;
  const secondSession = await (await context.request('/sessions', 'POST', { provider: 'other', workingDirectory: context.directory })).json() as Session;
  const first = connect(context.base, firstSession.id, context.headers);
  const second = connect(context.base, secondSession.id, context.headers);
  await waitFor(() => output(first.messages).includes('READY') && output(second.messages).includes('READY'));
  first.socket.send(JSON.stringify({ type: 'input', data: 'first-only' }));
  second.socket.send(JSON.stringify({ type: 'input', data: 'second-only' }));
  await waitFor(() => output(first.messages).includes('INPUT first-only') && output(second.messages).includes('INPUT second-only'));
  assert(!output(first.messages).includes('second-only'));
  assert(!output(second.messages).includes('first-only'));
  first.socket.close();
  await once(first.socket, 'close');
  const reconnected = connect(context.base, firstSession.id, context.headers);
  await waitFor(() => output(reconnected.messages).includes('INPUT first-only'));
  await context.request(`/sessions/${firstSession.id}`, 'DELETE');
  await waitFor(() => context.sessions.getRuntime(firstSession.id).info.status === 'exited');
  assert.equal(context.sessions.getRuntime(secondSession.id).info.status, 'running');
  second.socket.send(JSON.stringify({ type: 'input', data: 'still-running' }));
  await waitFor(() => output(second.messages).includes('INPUT still-running'));
  context.sessions.shutdown();
  await waitFor(() => context.sessions.sessions.every((session) => session.status === 'exited'));
});

test('history deletion checks every running terminal, not just the latest', async (t) => {
  const deleted: string[] = [];
  const context = await setup([
    { ...fixtureProvider, deleteSession: async (id) => { deleted.push(id); } },
    { ...fixtureProvider, id: 'other', name: 'Other' },
  ]);
  t.after(context.cleanup);
  const first = await (await context.request('/sessions', 'POST', { workingDirectory: context.directory })).json() as Session;
  const second = await (await context.request('/sessions', 'POST', { workingDirectory: context.directory })).json() as Session;
  await context.request('/sessions', 'POST', { provider: 'other', workingDirectory: context.directory });
  assert.equal((await context.request('/sessions/history/codex/native-id', 'DELETE')).status, 409);
  await context.request(`/sessions/${first.id}`, 'DELETE');
  await waitFor(() => context.sessions.getRuntime(first.id).info.status === 'exited');
  assert.equal((await context.request('/sessions/history/codex/native-id', 'DELETE')).status, 409);
  await context.request(`/sessions/${second.id}`, 'DELETE');
  await waitFor(() => context.sessions.getRuntime(second.id).info.status === 'exited');
  assert.equal((await context.request('/sessions/history/codex/native-id', 'DELETE')).status, 200);
  assert.deepEqual(deleted, ['native-id']);
  assert.equal(context.sessions.session?.status, 'running');
});

test('discovers public metadata and launches a selected adapter through the same API', async (t) => {
  const alternate: ProviderAdapter = {
    id: 'fixture-agent', name: 'Fixture Agent', installationHint: 'Install the fixture agent.',
    listSessions: async () => [],
    deleteSession: async () => {},
    getLaunchConfig: (workingDirectory) => ({
      executable: process.execPath,
      args: [fixture, 'alternate-argument'],
      env: { AGENTDEX_FIXTURE_MARKER: workingDirectory },
    }),
  };
  const context = await setup([fixtureProvider, alternate]);
  t.after(context.cleanup);
  const response = await context.request('/providers');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json() as ProvidersResponse, {
    providers: [{ id: 'codex', name: 'Codex' }, { id: 'fixture-agent', name: 'Fixture Agent' }],
    defaultProviderId: 'codex',
  });
  const created = await context.request('/sessions', 'POST', { provider: 'fixture-agent', workingDirectory: context.directory });
  assert.equal(created.status, 201);
  const session = await created.json() as Session;
  assert.equal(session.provider, 'fixture-agent');
  const terminal = connect(context.base, session.id, context.headers);
  await waitFor(() => output(terminal.messages).includes(`MARKER ${context.directory} alternate-argument`));
  terminal.socket.send(JSON.stringify({ type: 'input', data: 'hello' }));
  await waitFor(() => output(terminal.messages).includes('INPUT hello'));
  await context.request(`/sessions/${session.id}`, 'DELETE');
  await waitFor(() => context.sessions.session?.status === 'exited');
  const codexSession = await context.request('/sessions', 'POST', { provider: 'codex', workingDirectory: context.directory });
  assert.equal(codexSession.status, 201);
  assert.equal((await codexSession.json() as Session).provider, 'codex');
});

test('rejects invalid provider IDs without launching or falling back', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  for (const provider of ['', 'unknown', 'toString', '__proto__', 123, null, {}, ['codex']]) {
    const response = await context.request('/sessions', 'POST', { provider, workingDirectory: context.directory });
    assert.equal(response.status, 400);
    assert.equal(context.sessions.session, null);
  }
});

test('sessions endpoint includes provider history when no Agentdex terminal exists', async (t) => {
  const stored = {
    activity: 'unknown' as const, id: 'external-history', title: 'Started outside Agentdex', workingDirectory: '/external',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', archived: false,
  };
  const context = await setup([{ ...fixtureProvider, listSessions: async () => [stored] }]);
  t.after(context.cleanup);
  const response = await context.request('/sessions');
  assert.equal(response.status, 200);
  const body = await response.json() as SessionsResponse;
  assert.equal(body.session, null);
  assert.deepEqual(body.sessions, [{ ...stored, provider: 'codex' }]);
  assert.deepEqual(body.discoveryErrors, []);
});

test('uses the selected adapter installation guidance for launch errors', async (t) => {
  const alternate: ProviderAdapter = {
    id: 'missing-agent', name: 'Missing Agent', installationHint: 'Set MISSING_AGENT_BIN.',
    listSessions: async () => [],
    deleteSession: async () => {},
    getLaunchConfig: () => ({ executable: '/missing-agentdex-agent', args: [] }),
  };
  const context = await setup([fixtureProvider, alternate]);
  t.after(context.cleanup);
  const response = await context.request('/sessions', 'POST', { provider: alternate.id, workingDirectory: context.directory });
  assert.equal(response.status, 503);
  const body = await response.json() as { error: string };
  assert.match(body.error, /Missing Agent.*MISSING_AGENT_BIN/);
  assert.doesNotMatch(body.error, /Codex|CODEX_BIN/);
});

test('rejects unauthorized HTTP and WebSocket access and invalid terminal messages', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  assert.equal((await context.request('/sessions', 'POST', {}, { Host: new URL(origin).host, Origin: origin })).status, 403);
  assert.equal((await context.request('/sessions', 'POST', {}, { ...context.headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await context.request('/sessions', 'GET', undefined, { ...context.headers, Host: 'evil.example' })).status, 403);
  assert.equal((await context.request('/sessions', 'POST', {}, { ...context.headers, Cookie: `agentdex=${'é'.repeat(64)}` })).status, 403);
  const response = await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  const session = await response.json() as Session;
  const denied = new WebSocket(`${context.base.replace('http:', 'ws:')}/api/sessions/${session.id}/terminal`, {
    headers: { Host: new URL(origin).host, Origin: origin },
  });
  denied.on('error', () => {});
  const [error] = await once(denied, 'error');
  assert.match(String(error), /403/);
  const terminal = connect(context.base, session.id, context.headers);
  await once(terminal.socket, 'open');
  const closed = once(terminal.socket, 'close');
  terminal.socket.send(JSON.stringify({ type: 'resize', cols: -1, rows: 24 }));
  const [code] = await closed;
  assert.equal(code, 1008);
  assert.equal(context.sessions.session?.status, 'running');
});

test('history deletion selects provider, requires confirmation and blocks running terminals', async (t) => {
  const deleted: string[] = [];
  const context = await setup([
    { ...fixtureProvider, deleteSession: async (id) => { deleted.push(`codex:${id}`); } },
    { ...fixtureProvider, id: 'agy', deleteSession: async (id) => { deleted.push(`agy:${id}`); } },
  ]);
  t.after(context.cleanup);
  assert.equal((await context.request('/sessions/history/agy/same-id', 'DELETE')).status, 400);
  assert.equal((await context.request('/sessions/history/agy/same-id', 'DELETE', { externalSessionsStopped: true })).status, 200);
  assert.equal((await context.request('/sessions/history/codex/same-id', 'DELETE')).status, 200);
  assert.deepEqual(deleted, ['agy:same-id', 'codex:same-id']);
  assert.equal((await context.request('/sessions/history/codex/%2E%2E%2Fbad', 'DELETE')).status, 400);
  assert.equal((await context.request('/sessions/history/unknown/id', 'DELETE')).status, 400);
  assert.equal((await context.request('/sessions/history/codex/id', 'DELETE', undefined, { Host: new URL(origin).host, Origin: origin })).status, 403);
  await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  assert.equal((await context.request('/sessions/history/codex/id', 'DELETE')).status, 409);
  assert.equal((await context.request('/sessions/history/agy/id', 'DELETE', { externalSessionsStopped: true })).status, 200);
});

test('saved-session requests resume by native ID, ignore request cwd, and reuse the same terminal', async (t) => {
  const savedDirectory = path.dirname(fixture);
  const savedId = 'resume-api-session';
  const context = await setup([{
    ...fixtureProvider,
    listSessions: async () => [{
      id: savedId, title: 'Saved conversation', workingDirectory: savedDirectory,
      activity: 'unknown', archived: false, createdAt: null, updatedAt: '2026-10-23T00:00:00.000Z',
    }],
    getResumeConfig: (directory, id) => {
      assert.equal(directory, savedDirectory);
      assert.equal(id, savedId);
      return { executable: process.execPath, args: [fixture] };
    },
  }]);
  t.after(context.cleanup);
  const input = { provider: 'codex', workingDirectory: '/ignored-request-directory', resumeSessionId: savedId };
  const responses = await Promise.all([context.request('/sessions', 'POST', input), context.request('/sessions', 'POST', input)]);
  for (const response of responses) assert.equal(response.status, 201);
  const [first, second] = await Promise.all(responses.map((response) => response.json() as Promise<Session>));
  assert(first && second);
  assert.equal(first.id, second.id);
  assert.equal(first.providerSessionId, savedId);
  assert.equal(first.workingDirectory, savedDirectory);
  const listed = await (await context.request('/sessions')).json() as SessionsResponse;
  assert.equal(listed.managedSessions.length, 1);
  assert.equal(listed.managedSessions[0]?.providerSessionId, savedId);
  const terminal = connect(context.base, first.id, context.headers);
  t.after(() => terminal.socket.close());
  await waitFor(() => output(terminal.messages).includes(`READY ${savedDirectory}`));
  terminal.socket.send(JSON.stringify({ type: 'input', data: 'resumed' }));
  await waitFor(() => output(terminal.messages).includes('INPUT resumed'));
});


test('session rename API persists titles while running and validates request bodies', async (t) => {
  let title = 'Original session';
  const saved = { id: 'rename-session', title, workingDirectory: '/project', activity: 'active' as const, archived: false, createdAt: null, updatedAt: '2026-10-23T00:00:00.000Z' };
  const context = await setup([{ ...fixtureProvider,
    listSessions: async () => [{ ...saved, title }],
    renameSession: async (id, value) => { assert.equal(id, saved.id); title = value; },
  }]);
  t.after(context.cleanup);
  const running = await context.sessions.create(context.directory, 'codex');
  const endpoint = `/sessions/history/codex/${saved.id}`;
  assert.equal((await context.request(endpoint, 'PATCH', { title: '  Renamed session  ' })).status, 200);
  const listed = await (await context.request('/sessions')).json() as SessionsResponse;
  assert.equal(listed.sessions[0]?.title, 'Renamed session');
  assert.equal(context.sessions.getRuntime(running.id).info.status, 'running');
  for (const body of [{}, null, { title: '' }, { title: 42 }, { title: 'a'.repeat(201) }]) {
    assert.equal((await context.request(endpoint, 'PATCH', body)).status, 400);
  }
  assert.equal((await context.request('/sessions/history/codex/missing', 'PATCH', { title: 'Title' })).status, 404);
  assert.equal((await context.request(endpoint, 'PATCH', { title: 'Unauthorized' }, { Host: context.headers.Host! })).status, 403);
  assert.equal(title, 'Renamed session');
});

test('managed polling skips history discovery and exposes task activity independently of lifecycle', async (t) => {
  let discoveries = 0;
  const context = await setup([{ ...fixtureProvider, listSessions: async () => { discoveries++; return []; } }]);
  t.after(context.cleanup);
  const session = await context.sessions.create(context.directory, 'codex');
  const runtime = context.sessions.getRuntime(session.id);
  const write = (data: string) => new Promise<void>((resolve) => runtime.terminal.write(data, resolve));
  const before = discoveries;
  const current = async () => {
    const response = await context.request('/sessions/managed');
    assert.equal(response.status, 200);
    return (await response.json() as { managedSessions: Session[] }).managedSessions[0]!;
  };
  assert.equal((await current()).taskActivity, 'unknown');
  await write('\x1b]7501;state=working\x07');
  assert.equal((await current()).taskActivity, 'running');
  await write('\x1b]7501;state=blocked:kind=question\x07');
  assert.equal((await current()).taskActivity, 'needs-input');
  assert.equal((await current()).status, 'running');
  assert.equal(discoveries, before);
  assert.equal((await context.request('/sessions/managed', 'GET', undefined, { ...context.headers, Host: 'evil.example' })).status, 403);
  await write('\x1b]7501;state=working\x07');
  context.sessions.stop(session.id);
  await waitFor(() => runtime.info.status === 'exited');
  assert.equal((await current()).taskActivity, 'unknown');
});

for (const providerId of ['codex', 'opencode', 'agy']) {
  test(`${providerId} managed activity authenticates, skips discovery, and follows provider reports and exit`, async (t) => {
    let discoveries = 0;
    const context = await setup([{
      ...fixtureProvider,
      id: providerId,
      listSessions: async () => { discoveries++; return []; },
      getLaunchConfig: () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/task-activity.mjs', import.meta.url))] }),
    }, ...(providerId === 'codex' ? [] : [fixtureProvider])]);
    t.after(context.cleanup);
    const before = discoveries;
    assert.equal((await context.request('/sessions/managed', 'GET', undefined, { Host: context.headers.Host! })).status, 403);
    assert.equal((await context.request('/sessions/managed/', 'GET', undefined, { Host: context.headers.Host! })).status, 403);
    const session = await context.sessions.create(context.directory, providerId);
    assert.equal(session.taskActivity, 'unknown');
    const runtime = context.sessions.getRuntime(session.id);
    await waitFor(() => runtime.serializer.serialize().includes('ACTIVITY_READY'));
    const listed = async () => {
      const response = await context.request('/sessions/managed');
      assert.equal(response.status, 200);
      return (await response.json() as { managedSessions: Session[] }).managedSessions[0]!;
    };
    assert.equal((await listed()).taskActivity, 'not-running');
    runtime.process.write('work');
    await waitFor(() => runtime.info.taskActivity === 'running');
    assert.equal((await listed()).taskActivity, 'running');
    runtime.process.write('input');
    await waitFor(() => runtime.info.taskActivity === 'needs-input');
    assert.equal((await listed()).taskActivity, 'needs-input');
    runtime.process.write('idle');
    await waitFor(() => runtime.info.taskActivity === 'not-running');
    assert.equal(runtime.info.status, 'running');
    runtime.process.write('work');
    await waitFor(() => runtime.info.taskActivity === 'running');
    runtime.process.write('quit');
    await waitFor(() => runtime.info.status === 'exited');
    assert.equal((await listed()).taskActivity, 'unknown');
    assert.equal(discoveries, before);
  });
}

test('native folder picker requires local authentication and validates input before opening a dialog', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  const denied = await context.request('/sessions/pick-directory', 'POST', { workingDirectory: '/tmp' }, { ...context.headers, Cookie: '' });
  assert.equal(denied.status, 403);
  const invalid = await context.request('/sessions/pick-directory', 'POST', { workingDirectory: 42 });
  assert.equal(invalid.status, 400);
});

test('settings endpoints preserve defaults, enforce access, and reject invalid writes', async t => {
  const context = await setup();
  t.after(context.cleanup);
  const initial = await context.request('/settings');
  assert.equal(initial.status, 200);
  const preferences = await initial.json();
  assert.equal(preferences.startingDirectory, context.directory);
  assert.equal(preferences.terminal.fontSize, 14);
  const saved = await context.request('/settings', 'PUT', { ...preferences, terminal: { fontSize: 18, scrollback: 0 } });
  assert.equal(saved.status, 200);
  assert.equal((await (await context.request('/settings')).json()).terminal.scrollback, 0);
  assert.equal((await context.request('/settings', 'PUT', { ...preferences, terminal: { fontSize: 99, scrollback: 0 } })).status, 400);
  assert.equal((await (await context.request('/settings')).json()).terminal.fontSize, 18);
  assert.equal((await context.request('/settings', 'PUT', preferences, { Host: 'evil.example', Origin: 'http://evil.example' })).status, 403);
  assert.equal((await context.request('/sessions/clear-memory', 'POST', undefined, { Host: 'evil.example', Origin: 'http://evil.example' })).status, 403);
});

test('terminal cleanup keeps running processes and reconnect snapshots retain scrollback', async t => {
  const context = await setup();
  t.after(context.cleanup);
  const preferences = await (await context.request('/settings')).json();
  await context.request('/settings', 'PUT', { ...preferences, terminal: { fontSize: 16, scrollback: 32 } });
  const session = await (await context.request('/sessions', 'POST', { workingDirectory: context.directory })).json() as Session;
  assert.equal(context.sessions.getRuntime(session.id).terminal.options.scrollback, 32);
  assert.deepEqual(await (await context.request('/sessions/clear-memory', 'POST')).json(), { clearedIds: [], failures: [] });
  const terminal = connect(context.base, session.id, context.headers);
  await waitFor(() => terminal.messages.some(m => m.type === 'snapshot'));
  const snapshot = terminal.messages.find(m => m.type === 'snapshot');
  assert.equal(snapshot?.type === 'snapshot' && snapshot.scrollback, 32);
  terminal.socket.close();
  context.sessions.stop(session.id);
  await waitFor(() => context.sessions.getRuntime(session.id).info.status === 'exited');
  assert.deepEqual(await (await context.request('/sessions/clear-memory', 'POST')).json(), { clearedIds: [session.id], failures: [] });
  assert.deepEqual(await (await context.request('/sessions/clear-memory', 'POST')).json(), { clearedIds: [], failures: [] });
  assert.throws(() => context.sessions.getRuntime(session.id), /not found/);
});
