import assert from 'node:assert/strict';
import { test } from 'node:test';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import trackMouseEncoding from '../src/lib/terminalMouse.js';

const { Terminal } = headless;
const { SerializeAddon } = serialize;

function write(terminal: InstanceType<typeof Terminal>, data: string) {
  return new Promise<void>((resolve) => terminal.write(data, resolve));
}

test('tracks SGR mouse encoding through enable, disable and reset', async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const encoding = trackMouseEncoding(terminal);
  assert.equal(encoding(), '');
  await write(terminal, '\x1b[?1002h\x1b[?1006h');
  assert.equal(encoding(), '\x1b[?1006h');
  await write(terminal, '\x1b[?1016h');
  assert.equal(encoding(), '\x1b[?1016h');
  await write(terminal, '\x1b[?1006l');
  assert.equal(encoding(), '');
  await write(terminal, '\x1b[?1000;1006h');
  assert.equal(encoding(), '\x1b[?1006h');
  await write(terminal, '\x1b[?1006l');
  assert.equal(encoding(), '');
  await write(terminal, '\x1b[?1016h');
  assert.equal(encoding(), '\x1b[?1016h');
  await write(terminal, '\x1bc');
  assert.equal(encoding(), '');
});

test('runtime reset also clears the tracked encoding', async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const encoding = trackMouseEncoding(terminal);
  await write(terminal, '\x1b[?1000h\x1b[?1006h');
  assert.equal(encoding(), '\x1b[?1006h');
  terminal.reset();
  assert.equal(encoding(), '');
});

test('serialization omits the encoding that reconnect snapshots must restore', async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const encoding = trackMouseEncoding(terminal);
  await write(terminal, '\x1b[?1002h\x1b[?1006hMOUSE_READY\r\n');
  const snapshot = serializer.serialize();
  assert.ok(snapshot.includes('\x1b[?1002h'));
  assert.ok(!snapshot.includes('\x1b[?1006h'));
  assert.ok((snapshot + encoding()).includes('\x1b[?1002h'));
  assert.ok((snapshot + encoding()).includes('\x1b[?1006h'));
});
