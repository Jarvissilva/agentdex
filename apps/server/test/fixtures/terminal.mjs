process.stdin.setRawMode(true);
process.stdout.write(`READY ${process.cwd()}\r\n`);
if (process.env.AGENTDEX_FIXTURE_MARKER) {
  process.stdout.write(`MARKER ${process.env.AGENTDEX_FIXTURE_MARKER} ${process.argv[2]}\r\n`);
}
process.on('SIGWINCH', () => process.stdout.write(`SIZE ${process.stdout.columns}x${process.stdout.rows}\r\n`));
process.stdin.on('data', (data) => {
  const input = data.toString();
  if (input.includes('\u0003')) process.exit(130);
  if (input.includes('quit')) process.exit(7);
  process.stdout.write(`INPUT ${input}\r\n`);
});
