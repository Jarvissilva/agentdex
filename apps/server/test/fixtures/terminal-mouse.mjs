process.stdin.setRawMode(true);
// The mouse modes a full-screen coding agent enables at startup. The SGR
// encoding must survive reconnect snapshots, which only restore tracking.
process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006hMOUSE_READY\r\n');
process.stdin.on('data', (data) => {
  const bytes = [...data].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  process.stdout.write(`BYTES ${bytes}\r\n`);
});
