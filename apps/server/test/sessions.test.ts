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
import SessionService from '../src/services/SessionService.js';
import ProviderRegistry from '../src/lib/providers/index.js';
import codex from '../src/lib/providers/codex.js';
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
    const request = httpRequest(url, { method, headers }, (response) => {
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
  const sessions = new SessionService(providers);
  const app = createApp({ providers, sessions, allowedOrigins: [origin], defaultWorkingDirectory: directory });
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
  first.socket.send(JSON.stringify({ type: 'input', data: 'hello' }));
  await waitFor(() => output(first.messages).includes('INPUT hello'));
  first.socket.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
  await waitFor(() => output(first.messages).includes('SIZE 90x28'));
  first.socket.close();
  await once(first.socket, 'close');
  assert.equal(context.sessions.session?.status, 'running');
  const second = connect(context.base, session.id, context.headers);
  await waitFor(() => output(second.messages).includes('INPUT hello'));
  assert.equal(second.messages[0]?.type, 'snapshot');
  second.socket.send(JSON.stringify({ type: 'input', data: 'quit' }));
  await waitFor(() => second.messages.some((message) => message.type === 'exit' && message.session.exitCode === 7));
  const replay = connect(context.base, session.id, context.headers);
  await waitFor(() => replay.messages.some((message) => message.type === 'snapshot' && message.session.status === 'exited'));
  const restarted = await context.request('/sessions', 'POST', { workingDirectory: context.directory });
  assert.equal(restarted.status, 201);
  assert.notEqual((await restarted.json() as Session).id, session.id);
});

test('validates directories, prevents concurrent launches, and stops sessions', async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  for (const workingDirectory of ['', 'relative/path', '/does-not-exist-agentdex', 123, null]) {
    assert.equal((await context.request('/sessions', 'POST', { workingDirectory })).status, 400);
  }
  const file = path.join(context.directory, 'file');
  await writeFile(file, 'not a directory');
  assert.equal((await context.request('/sessions', 'POST', { workingDirectory: file })).status, 400);
  const responses = await Promise.all([1, 2].map(() => context.request('/sessions', 'POST', { workingDirectory: context.directory })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const id = context.sessions.session!.id;
  assert.equal((await context.request(`/sessions/${id}`, 'DELETE')).status, 202);
  await waitFor(() => context.sessions.session?.status === 'exited');
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

test('discovers public metadata and launches a selected adapter through the same API', async (t) => {
  const alternate: ProviderAdapter = {
    id: 'fixture-agent', name: 'Fixture Agent', installationHint: 'Install the fixture agent.',
    listSessions: async () => [],
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
    id: 'external-history', title: 'Started outside Agentdex', workingDirectory: '/external',
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
