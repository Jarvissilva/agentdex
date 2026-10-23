import type { McpCredentials, McpDefinition } from '@agentdex/shared';
import HttpError from './HttpError.js';

export const credentialMask = '••••••';
export type { McpCredentials } from '@agentdex/shared';
export function maskDefinition(definition: McpDefinition): McpDefinition {
  return { ...definition, ...Object.fromEntries((['env', 'headers'] as const).filter(key => definition[key] !== undefined).map(key => [key, Object.fromEntries(Object.keys(definition[key]!).map(name => [name, credentialMask]))])) };
}
export function credentialValues(definition: McpDefinition): McpCredentials {
  return Object.fromEntries((['env', 'headers'] as const).map(key => [key, Object.fromEntries(Object.entries(definition[key] ?? {}).filter(([, value]) => value !== credentialMask))]));
}
export function providerEntry(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function providerCredentials(value: unknown, transport: McpDefinition['transport']): McpCredentials {
  const entry = providerEntry(value);
  if (!entry) return {};
  const fields: { env?: unknown; headers?: unknown } = transport === 'stdio' ? { env: entry.env ?? entry.environment } : { headers: entry.http_headers ?? entry.headers };
  const result: McpCredentials = {};
  for (const field of ['env', 'headers'] as const) {
    const values = fields[field];
    if (values === undefined) continue;
    const record = providerEntry(values);
    if (!record || !Object.values(record).every(v => typeof v === 'string')) throw new HttpError(409, 'Provider credentials have an unsupported format.');
    // Native environment/file interpolation remains owned by the source provider.
    result[field] = Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/\{(?:env|file):|\$\{/.test(entry[1])));
  }
  return result;
}
export function withoutCredentialValues(value: unknown): unknown {
  const entry = providerEntry(value);
  if (!entry) return value;
  return Object.fromEntries(Object.entries(entry).map(([key, field]) => {
    if (['env', 'environment', 'headers', 'http_headers'].includes(key)) {
      const record = providerEntry(field);
      if (record) return [key, Object.fromEntries(Object.keys(record).sort().map(name => [name, credentialMask]))];
    }
    return [key, field];
  }));
}
