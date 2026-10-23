import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpJson } from '../src/lib/mcpJson.ts';

test('accepts direct and named MCP JSON with native defaults and preserved secret placeholders', () => {
  assert.deepEqual(parseMcpJson('{"command":"node","args":["server.js"],"env":{"TOKEN":"••••••"}}'), { name: undefined, definition: { transport: 'stdio', enabled: true, command: 'node', args: ['server.js'], env: { TOKEN: '••••••' } } });
  assert.deepEqual(parseMcpJson('{"mcpServers":{"remote":{"serverUrl":"https://example.com/mcp","headers":{"Authorization":"token"},"disabled":true}}}'), { name: 'remote', definition: { transport: 'http', enabled: false, url: 'https://example.com/mcp', headers: { Authorization: 'token' } } });
  assert.equal(parseMcpJson('{"transport":"stdio","command":"node","enabled":false,"cwd":"/tmp"}').definition.cwd, '/tmp');
});

test('rejects malformed JSON, multiple servers and invalid fields without echoing secrets', () => {
  for (const input of ['{private-secret', 'null', '[]', '{"mcpServers":{}}', '{"mcpServers":{"one":{},"two":{}}}', '{"command":"node","args":[1]}', '{"command":"node","env":{"TOKEN":42}}', '{"command":"node","enabled":"yes"}']) {
    assert.throws(() => parseMcpJson(input), error => error instanceof Error && !error.message.includes('private-secret'));
  }
});
