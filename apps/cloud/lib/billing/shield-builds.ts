/**
 * The Shield installers the site offers. Safe to import in client components (no secrets).
 * A platform is offered once its build is in storage: list it in NEXT_PUBLIC_SHIELD_PLATFORMS.
 */

export type ShieldPlatform = 'windows' | 'mac' | 'linux';

export type ShieldBuild = { arch: string; label: string; sha256?: string };

export type ShieldPlatformInfo = {
  name: string;
  requirements: string;
  install: string;
  primary: ShieldBuild;
  /** A second file for the platform, when there is one. Windows ships the installer only. */
  secondary?: ShieldBuild;
};

export const SHIELD_VERSION = process.env.NEXT_PUBLIC_SHIELD_VERSION || '0.4.0';

export const SHIELD_PLATFORM_ORDER: ShieldPlatform[] = ['windows', 'mac', 'linux'];

/** Checksums are for SHIELD_VERSION; scripts/upload-shield-release.sh prints them for each release. */
export const SHIELD_PLATFORMS: Record<ShieldPlatform, ShieldPlatformInfo> = {
  windows: {
    name: 'Windows',
    requirements: 'Windows 10 or 11, x64',
    install:
      'The installer is not code-signed yet, so Windows may show "Windows protected your PC". Choose More info, then Run anyway.',
    primary: {
      arch: 'x64',
      label: 'Installer (.exe)',
      sha256: '1e3de5069a17021309bd4963d3218af0e6b090f59f21605c36dd3f9b193e5394',
    },
  },
  mac: {
    name: 'macOS',
    requirements: 'macOS 12 Monterey or newer',
    install: 'Open the .dmg and drag Mastyf Shield to Applications.',
    primary: { arch: 'arm64', label: 'Apple Silicon (.dmg)' },
    secondary: { arch: 'x64', label: 'Intel (.dmg)' },
  },
  linux: {
    name: 'Linux',
    requirements: 'glibc 2.28+, x86_64',
    install: 'Run the AppImage, or install the .deb.',
    primary: { arch: 'appimage', label: 'AppImage' },
    secondary: { arch: 'deb', label: 'Debian / Ubuntu (.deb)' },
  },
};

/** The platform a download request names. Anything unknown means macOS, as the storage key lookup does. */
export function shieldPlatformOf(os?: string | null): ShieldPlatform {
  const value = (os || '').trim().toLowerCase();
  if (value === 'win' || value === 'windows') return 'windows';
  if (value === 'linux') return 'linux';
  return 'mac';
}

/** Read on each call, so a deploy with a new list takes effect without code changes. */
export function shieldPlatformAvailable(platform: ShieldPlatform): boolean {
  return (process.env.NEXT_PUBLIC_SHIELD_PLATFORMS || 'windows')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .includes(platform);
}

/** A signed-in subscriber's download link. It carries no key: the route checks the session. */
export function shieldDownloadPath(platform: ShieldPlatform, arch: string): string {
  return `/api/v1/download/shield?os=${platform}&arch=${encodeURIComponent(arch)}`;
}
