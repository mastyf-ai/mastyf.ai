/** Where the Shield app is installed, from its Windows uninstall entry (the folder can be changed at install). */
import { win32 as path } from 'node:path';
import type { Env } from './settings';

export const SHIELD_EXE = 'Mastyf Shield.exe';

/** `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall /s /f "Mastyf Shield" /d` */
export const REG_QUERY_ARGS = [
  'query',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  '/s',
  '/f',
  'Mastyf Shield',
  '/d',
];

function regValue(regOutput: string, name: string): string | null {
  const m = regOutput.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'm'));
  return m ? m[1] : null;
}

/** The folder of a path that may be quoted and followed by arguments: `"C:\x\y.exe" /currentuser`. */
function folderOf(value: string | null): string | null {
  if (!value) return null;
  const quoted = value.match(/^"([^"]+)"/);
  const file = quoted ? quoted[1] : value.split(',')[0].trim();
  return /^[A-Za-z]:\\/.test(file) ? path.dirname(file) : null;
}

export function findShieldExe(regOutput: string, env: Env, exists: (p: string) => boolean): string | null {
  const folders = [folderOf(regValue(regOutput, 'DisplayIcon')), folderOf(regValue(regOutput, 'UninstallString'))];
  if (env.LOCALAPPDATA) folders.push(path.join(env.LOCALAPPDATA, 'Programs', 'Mastyf Shield'));
  for (const folder of folders) {
    if (!folder) continue;
    const exe = path.join(folder, SHIELD_EXE);
    if (exists(exe)) return exe;
  }
  return null;
}

/** "Mastyf Shield 0.5.2" → "0.5.2". */
export function shieldVersionFromReg(regOutput: string): string | null {
  const name = regValue(regOutput, 'DisplayName');
  const m = name?.match(/^Mastyf Shield\s+(\d+\.\d+\.\d+\S*)$/);
  return m ? m[1] : null;
}
