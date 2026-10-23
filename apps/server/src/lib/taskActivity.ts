import type { Terminal } from '@xterm/headless';
import type { Session } from '@agentdex/shared';

// Protocol: https://www.superlogical.com/rex/docs/build/program-status
// OSC 7501 records belong to the PTY, including while no browser is attached.
export default function trackTaskActivity(terminal: Terminal, reply: (data: string) => void, update: (activity: Session['taskActivity']) => void) {
  const records = new Map<string, string>();
  const publish = () => update([...records.values()].includes('blocked') ? 'needs-input' : [...records.values()].includes('working') ? 'running' : records.size ? 'not-running' : 'unknown');
  const clear = () => { records.clear(); publish(); };
  terminal.parser.registerOscHandler(7501, (data) => {
    if (data === '?') { reply('\x1b]7501;?\x1b\\'); return true; }
    if (Buffer.byteLength(data) + 9 > 4096) return true;
    const pairs = new Map<string, string>();
    for (const pair of data.split(':')) {
      const match = /^([a-z]+)\s*=\s*([A-Za-z0-9_.,+/=-]*)$/.exec(pair.trim());
      if (!match) continue;
      const key = match[1]!;
      const value = match[2]!;
      if (key.length > 16) return true;
      const limit = { msg: 2732, title: 256, app: 32, id: 128 }[key];
      if (limit !== undefined && value.length > limit) return true;
      if (key === 'msg' || key === 'title') {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.replace(/=+$/, '').length % 4 === 1 || (value.includes('=') && value.length % 4 !== 0)) return true;
        const decoded = Buffer.from(value, 'base64');
        if (decoded.length > (key === 'msg' ? 2048 : 192)) return true;
        try {
          if ([...new TextDecoder('utf-8', { fatal: true }).decode(decoded)].some((character) => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159); })) return true;
        } catch { return true; }
      }
      pairs.set(key, value);
    }
    const state = pairs.get('state');
    if (!state || !['idle', 'working', 'done', 'blocked', 'error', 'clear'].includes(state)) return true;
    const id = pairs.get('id') ?? '';
    if (pairs.has('id') && (!/^[A-Za-z0-9_.+-]{1,32}(\/[A-Za-z0-9_.+-]{1,32})*$/.test(id) || id.split('/').length > 8)) return true;
    if (state === 'clear') {
      for (const key of records.keys()) if (!id || key === id || key.startsWith(`${id}/`)) records.delete(key);
    } else {
      records.delete(id);
      if (records.size >= 256) records.delete(records.keys().next().value!);
      records.set(id, state);
    }
    publish();
    return true;
  });
  terminal.parser.registerEscHandler({ final: 'c' }, () => { clear(); return false; });
  const reset = terminal.reset.bind(terminal);
  terminal.reset = () => { clear(); reset(); };
  return clear;
}
