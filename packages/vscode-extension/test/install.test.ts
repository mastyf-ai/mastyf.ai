import { describe, expect, it } from 'vitest';
import { findShieldExe, shieldVersionFromReg } from '../src/install';

const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\u' };

// The shape of `reg query HKCU\...\Uninstall /s /f "Mastyf Shield" /d` on a real 0.5.2 install.
const reg = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ee8dd636-3d0a-5eba-8f30-0797dc3997ac',
  '    DisplayName    REG_SZ    Mastyf Shield 0.5.2',
  '    UninstallString    REG_SZ    "D:\\Apps\\Mastyf Shield\\Uninstall Mastyf Shield.exe" /currentuser',
  '    DisplayIcon    REG_SZ    D:\\Apps\\Mastyf Shield\\uninstallerIcon.ico',
  '',
  'End of search: 3 match(es) found.',
].join('\r\n');

describe('findShieldExe', () => {
  it('uses the install folder from the uninstall entry (users can move it)', () => {
    const exists = (p: string) => p === 'D:\\Apps\\Mastyf Shield\\Mastyf Shield.exe';
    expect(findShieldExe(reg, env, exists)).toBe('D:\\Apps\\Mastyf Shield\\Mastyf Shield.exe');
  });

  it('falls back to the default folder when there is no entry', () => {
    const def = 'C:\\Users\\u\\AppData\\Local\\Programs\\Mastyf Shield\\Mastyf Shield.exe';
    expect(findShieldExe('', env, (p) => p === def)).toBe(def);
  });

  it('null when neither exists', () => {
    expect(findShieldExe(reg, env, () => false)).toBeNull();
  });
});

describe('shieldVersionFromReg', () => {
  it('reads the version from the display name', () => {
    expect(shieldVersionFromReg(reg)).toBe('0.5.2');
    expect(shieldVersionFromReg('')).toBeNull();
  });
});
