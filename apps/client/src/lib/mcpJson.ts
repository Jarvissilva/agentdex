import type { McpDefinition } from '@agentdex/shared';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseMcpJson(text: string): { name?: string; definition: McpDefinition } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Enter valid MCP JSON.'); }
  if (!object(value)) throw new Error('MCP JSON must be an object.');
  let name: string | undefined;
  if ('mcpServers' in value) {
    if (!object(value.mcpServers) || Object.keys(value.mcpServers).length !== 1) throw new Error('Paste one MCP server at a time.');
    const entry = Object.entries(value.mcpServers)[0]!;
    name = entry[0]; value = entry[1];
  }
  if (!object(value)) throw new Error('The MCP server definition must be an object.');
  const transport = value.transport ?? (value.url || value.serverUrl ? 'http' : 'stdio');
  const enabled = value.enabled ?? (value.disabled === undefined ? true : !value.disabled);
  if ((transport !== 'stdio' && transport !== 'http') || typeof enabled !== 'boolean' || (value.disabled !== undefined && typeof value.disabled !== 'boolean')) throw new Error('Invalid MCP transport or enabled state.');
  const definition: McpDefinition = { transport, enabled };
  if (transport === 'stdio') {
    if (typeof value.command !== 'string' || !value.command.trim()) throw new Error('A stdio MCP requires a command.');
    definition.command = value.command;
    if (value.args !== undefined) {
      if (!Array.isArray(value.args) || !value.args.every((arg): arg is string => typeof arg === 'string')) throw new Error('MCP arguments must be an array of strings.');
      definition.args = value.args;
    }
    if (value.cwd !== undefined) {
      if (typeof value.cwd !== 'string') throw new Error('The working directory must be a string.');
      definition.cwd = value.cwd;
    }
  } else {
    const url = value.url ?? value.serverUrl;
    if (typeof url !== 'string') throw new Error('An HTTP MCP requires a URL.');
    definition.url = url;
  }
  for (const key of ['env', 'headers'] as const) {
    const entries = value[key];
    if (entries === undefined) continue;
    if (!object(entries)) throw new Error(`MCP ${key} must be an object of strings.`);
    const result: Record<string, string> = {};
    for (const [entry, content] of Object.entries(entries)) {
      if (typeof content !== 'string') throw new Error(`MCP ${key} values must be strings.`);
      Object.defineProperty(result, entry, { value: content, enumerable: true, writable: true, configurable: true });
    }
    definition[key] = result;
  }
  return { name, definition };
}
