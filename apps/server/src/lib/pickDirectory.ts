import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import HttpError from './HttpError.js';
import resolveExecutable from './resolveExecutable.js';

const execute = promisify(execFile);
let picking = false;

export default async function pickDirectory(value: unknown, signal?: AbortSignal): Promise<string | null> {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 4096) throw new HttpError(400, 'Enter a valid starting directory.');
  if (picking) throw new HttpError(409, 'A folder picker is already open.');
  picking = true;
  try {
    let start = value === '~' ? homedir() : value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value;
    if (!path.isAbsolute(start) || !(await stat(start).catch(() => null))?.isDirectory()) start = homedir();
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = '/usr/bin/osascript';
      args = ['-e', 'on run argv\ntry\nreturn POSIX path of (choose folder with prompt "Choose working directory" default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', start];
    } else if (process.platform === 'win32') {
      command = 'powershell.exe';
      args = ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose working directory"; $picker.SelectedPath = $env:AGENTDEX_PICKER_START; if ($picker.ShowDialog() -eq "OK") { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath) }; $picker.Dispose()'];
    } else if (process.platform === 'linux') {
      const zenity = await resolveExecutable('zenity', process.env.PATH);
      const kdialog = zenity ? null : await resolveExecutable('kdialog', process.env.PATH);
      if (!zenity && !kdialog) throw new HttpError(503, 'Install zenity or kdialog to use the system folder picker, or enter the directory path.');
      command = zenity ?? kdialog!;
      args = zenity ? ['--file-selection', '--directory', '--title=Choose working directory', `--filename=${start.endsWith(path.sep) ? start : start + path.sep}`] : ['--getexistingdirectory', start, '--title', 'Choose working directory'];
    } else throw new HttpError(503, 'The system folder picker is unavailable. Enter the directory path.');
    let stdout: string;
    try {
      ({ stdout } = await execute(command, args, {
        encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024, signal,
        env: { ...process.env, AGENTDEX_PICKER_START: start },
      }));
    } catch (error) {
      if (process.platform === 'linux' && error && typeof error === 'object' && 'code' in error && error.code === 1
        && !('stderr' in error && typeof error.stderr === 'string' && /cannot open display|could not connect|failed to open display/i.test(error.stderr))) return null;
      throw new HttpError(503, 'Unable to open the system folder picker. Check that AgentDex is running in a desktop session, or enter the directory path.');
    }
    const directory = stdout.replace(/[\r\n]+$/, '');
    if (!directory) return null;
    if (!path.isAbsolute(directory) || !(await stat(directory).catch(() => null))?.isDirectory()) throw new HttpError(400, 'The selected directory is unavailable. Choose another folder.');
    return directory;
  } finally { picking = false; }
}
