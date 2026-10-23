import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import createApp from '../src/app.js';
import LibraryService from '../src/services/LibraryService.js';
import type { LibraryItem } from '@agentdex/shared';

test('library API authenticates mutations, never publishes on GET/save, and redacts mutation responses', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agentdex-library-api-'));
  const root = path.join(home, '.local/share/agentdex');
  const origin = 'http://127.0.0.1:5173';
  const app = createApp({ allowedOrigins: [origin], library: new LibraryService({ home, root, codexHome: path.join(home, '.codex'), configHome: path.join(home, '.config') }) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => { app.close(); await once(app.server, 'close'); await rm(home, { recursive: true, force: true }); });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  let cookie = '';
  async function send(endpoint: string, method = 'GET', body?: unknown) {
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${port}/api${endpoint}`, { method, headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' } }, response => {
        let text = '';
        response.on('data', chunk => { text += String(chunk); });
        response.on('end', () => { cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? cookie; resolve({ status: response.statusCode!, body: JSON.parse(text) as Record<string, unknown> }); });
      });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  assert.equal((await send('/mcps', 'POST', {})).status, 403);
  assert.equal((await send('/skills')).status, 200);
  await assert.rejects(stat(root), { code: 'ENOENT' });
  const response = await send('/mcps', 'POST', { name: 'Remote', definition: { transport: 'http', enabled: true, url: 'https://example.com/mcp', headers: { Authorization: 'never-return-this' } } });
  assert.equal(response.status, 201);
  const item = response.body.item as LibraryItem;
  assert.equal(item.definition!.headers!.Authorization, '••••••');
  await assert.rejects(stat(path.join(home, '.codex')), { code: 'ENOENT' });
  assert.equal((await send(`/mcps/${item.id}/sync`, 'POST', { destinations: ['agents'] })).status, 400);
  const synced = await send(`/mcps/${item.id}/sync`, 'POST', { destinations: ['codex'] });
  assert.equal(synced.status, 200);
  assert.deepEqual(synced.body.results, [{ destination: 'codex', status: 'installed' }]);
  assert.equal((await send(`/mcps/${item.id}`, 'PUT', { name: 'Renamed', definition: item.definition })).status, 200);
  assert.equal((await send(`/mcps/${item.id}/uninstall`, 'POST', { destinations: ['codex'] })).status, 200);
  assert.equal((await send(`/mcps/${item.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await send('/mcps')).body.items, []);
});
