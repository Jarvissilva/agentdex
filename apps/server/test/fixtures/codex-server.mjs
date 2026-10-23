#!/usr/bin/env node
import { createInterface } from 'node:readline';

function thread(id, updatedAt, extra = {}) {
  return { id, cwd: '/external/project', name: null, preview: `External ${id}`, createdAt: 1700000000, updatedAt, ...extra };
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (!('id' in message)) return;
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    return;
  }
  const params = message.params;
  if (message.method !== 'thread/list' || params.cwd !== undefined || params.modelProviders.length
    || !params.sourceKinds.includes('exec') || !params.sourceKinds.includes('appServer') || !params.sourceKinds.includes('subAgent')) {
    process.stdout.write(`${JSON.stringify({ id: message.id, error: { message: 'Incorrect list filters' } })}\n`);
    return;
  }
  let result;
  if (params.archived) result = { data: [thread('archived', 1700000003, { name: 'Archived title' })], nextCursor: null };
  else if (params.cursor === null) result = { data: [thread('first', 1700000001)], nextCursor: 'second-page' };
  else if (params.cursor === 'second-page') result = { data: [thread('second', 1700000002), thread('first', 1700000001)], nextCursor: null };
  else result = { data: [], nextCursor: null };
  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
