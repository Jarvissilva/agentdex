process.stdin.setRawMode(true);
process.stdout.write(`COLOR_ENABLED ${process.env.NO_COLOR === undefined}\r\n`);
let pending = '';
const seen = new Set();
process.stdin.on('data', (data) => {
  pending += data.toString();
  let end;
  while ((end = pending.indexOf('\x1b\\')) !== -1) {
    const sequence = pending.slice(0, end);
    pending = pending.slice(end + 2);
    if (!sequence.startsWith('\x1b]')) continue;
    const match = sequence.slice(2).match(/^(10|11|12);rgb:([0-9a-f/]+)$/);
    if (!match) continue;
    process.stdout.write(`COLOR ${match[1]} ${match[2]}\r\n`);
    seen.add(match[1]);
  }
  if (seen.size === 3) {
    seen.clear();
    process.stdout.write('\x1b[48;2;40;41;43mINPUT BAR\x1b[0m\r\nCOLOR_READY\r\n');
  }
});
// Both OSC terminators and queries split between PTY output chunks must work.
process.stdout.write('\x1b]10;');
setTimeout(() => process.stdout.write('?\x07\x1b]11;?\x1b\\\x1b]12;?\x07'), 20);
