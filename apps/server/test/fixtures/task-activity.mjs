process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b]7501;?\x07');
let probing = true;
let reply = '';
process.stdin.on('data', (chunk) => {
  const input = chunk.toString();
  if (probing) {
    reply += input;
    if (reply.includes('\x1b]7501;?\x1b\\')) {
      probing = false;
      process.stdout.write('\x1b]7501;state=idle\x07ACTIVITY_READY\r\n');
    }
    return;
  }
  if (input === 'work') process.stdout.write('\x1b]7501;state=working\x1b\\');
  else if (input === 'input') process.stdout.write('\x1b]7501;state=blocked:kind=question\x07');
  else if (input === 'idle') process.stdout.write('\x1b]7501;state=idle\x07');
  else if (input === 'quit') process.exit(0);
});
