import type { Terminal } from '@xterm/headless';

// SerializeAddon restores tracking (1000/1002/1003), but omits mouse encoding.
export default function trackMouseEncoding(terminal: Terminal): () => string {
  let encoding: 1006 | 1016 | undefined;
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
    for (const param of params) if (param === 1006 || param === 1016) encoding = param;
    return false;
  });
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
    for (const param of params) if (param === 1006 || param === 1016) encoding = undefined;
    return false;
  });
  terminal.parser.registerEscHandler({ final: 'c' }, () => { encoding = undefined; return false; });
  const reset = terminal.reset.bind(terminal);
  terminal.reset = () => { encoding = undefined; reset(); };
  return () => encoding ? `\x1b[?${encoding}h` : '';
}
