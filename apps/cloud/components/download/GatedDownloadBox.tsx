'use client';

import { useState, useEffect } from 'react';

type Props = {
  initialSession: boolean;
  version: string;
  sha256: string;
  checkoutUrl: string;
};

type OperatingSystem = 'mac' | 'windows' | 'linux';

interface OSDetails {
  id: OperatingSystem;
  name: string;
  icon: string;
  badge: string;
  archs: string;
  filename: string;
  notes: string;
  primaryExt: string;
}

const OS_OPTIONS: Record<OperatingSystem, OSDetails> = {
  mac: {
    id: 'mac',
    name: 'macOS',
    icon: '🍏',
    badge: 'Universal (Apple Silicon & Intel)',
    archs: 'Apple Silicon (M1/M2/M3/M4) & Intel x86_64',
    filename: 'Mastyf-Shield-latest.dmg',
    notes: 'macOS 12 (Monterey) or newer. Works with Claude Desktop, Cursor, and Windsurf.',
    primaryExt: '.dmg',
  },
  windows: {
    id: 'windows',
    name: 'Windows',
    icon: '🪟',
    badge: 'Windows 10 / 11 (64-bit)',
    archs: 'x64 & ARM64 Architecture',
    filename: 'Mastyf-Shield-Setup-latest.exe',
    notes: 'Windows 10/11 x64. Installs background service with automatic port 4000 mediation.',
    primaryExt: '.exe',
  },
  linux: {
    id: 'linux',
    name: 'Linux',
    icon: '🐧',
    badge: 'Ubuntu / Debian / Fedora / Arch',
    archs: 'glibc 2.28+ · x86_64 & arm64',
    filename: 'Mastyf-Shield-latest.AppImage',
    notes: 'Standalone AppImage and Debian (.deb) package with systemd user service support.',
    primaryExt: '.AppImage',
  },
};

export function GatedDownloadBox({ initialSession, version, sha256, checkoutUrl }: Props) {
  const [selectedOs, setSelectedOs] = useState<OperatingSystem>('mac');
  const [licenseKey, setLicenseKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [verifiedPlan, setVerifiedPlan] = useState('');

  // Auto-detect OS on client mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = window.navigator.userAgent.toLowerCase();
    if (ua.includes('win')) {
      setSelectedOs('windows');
    } else if (ua.includes('linux') && !ua.includes('android')) {
      setSelectedOs('linux');
    } else {
      setSelectedOs('mac');
    }
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) {
      setStatus('error');
      setErrorMessage('Please enter your license key.');
      return;
    }

    setStatus('verifying');
    setErrorMessage('');

    try {
      const res = await fetch('/api/v1/license/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setStatus('verified');
        setVerifiedPlan(data.plan || 'Mastyf Developer Pro');
      } else {
        setStatus('error');
        setErrorMessage(data.message || 'Invalid or expired license key. Please check and try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Failed to connect to license server. Please verify your connection.');
    }
  };

  const currentOs = OS_OPTIONS[selectedOs];
  const downloadUrl = `/api/v1/download/shield?key=${encodeURIComponent(licenseKey.trim())}&os=${selectedOs}`;

  return (
    <div className="card p-8 my-8 bg-[#0a0f1d] border border-amber-500/30 shadow-2xl rounded-2xl">
      {/* OS Selector Tabs */}
      <div className="flex items-center justify-between border-b border-white/10 pb-5 mb-6 flex-wrap gap-4">
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
            Select Your Platform:
          </span>
          <div className="flex items-center gap-2">
            {(Object.keys(OS_OPTIONS) as OperatingSystem[]).map((osKey) => {
              const os = OS_OPTIONS[osKey];
              const isSelected = selectedOs === osKey;
              return (
                <button
                  key={osKey}
                  type="button"
                  onClick={() => setSelectedOs(osKey)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-md shadow-amber-500/10'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <span className="text-base">{os.icon}</span>
                  <span>{os.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-right hidden sm:block">
          <span className="text-[11px] font-mono text-slate-500 block">Single License Coverage:</span>
          <span className="text-xs font-semibold text-slate-300">
            ✓ 1 License unlocks macOS, Windows &amp; Linux
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="lp-pill lp-pill-gold text-[11px] flex items-center gap-1.5">
              <span>{currentOs.icon}</span>
              <span>{currentOs.badge}</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">{currentOs.archs}</span>
          </div>
          <h3 className="text-2xl font-bold text-white">Mastyf Shield Desktop v{version}</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
            {currentOs.notes}
          </p>
        </div>

        <div className="shrink-0 flex flex-col gap-3 w-full md:w-auto">
          {/* OS Download Buttons (Immediate under Approach A) */}
          <div className="flex flex-col gap-2">
            {selectedOs === 'mac' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  className="btn btn-primary btn-pill text-center font-bold px-6 py-3 shadow-lg shadow-amber-500/20 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=arm64`}
                >
                  <span>🍏</span> Download for Apple Silicon (.dmg)
                </a>
                <a
                  className="btn btn-secondary btn-pill text-center font-bold px-5 py-3 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=x64`}
                >
                  <span>⚙️</span> Intel Mac (.dmg)
                </a>
              </div>
            )}

            {selectedOs === 'windows' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  className="btn btn-primary btn-pill text-center font-bold px-6 py-3 shadow-lg shadow-amber-500/20 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=x64`}
                >
                  <span>🪟</span> Download Windows Installer (.exe)
                </a>
                <a
                  className="btn btn-secondary btn-pill text-center font-bold px-5 py-3 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=zip`}
                >
                  <span>📦</span> Portable (.zip)
                </a>
              </div>
            )}

            {selectedOs === 'linux' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  className="btn btn-primary btn-pill text-center font-bold px-6 py-3 shadow-lg shadow-amber-500/20 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=appimage`}
                >
                  <span>🐧</span> Download Linux AppImage
                </a>
                <a
                  className="btn btn-secondary btn-pill text-center font-bold px-5 py-3 text-xs flex items-center justify-center gap-2"
                  href={`${downloadUrl}&arch=deb`}
                >
                  <span>📦</span> Debian / Ubuntu (.deb)
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 font-mono">
              In-app activation required upon first launch
            </span>
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1"
            >
              Get Developer License ($49/mo) ↗
            </a>
          </div>
        </div>
      </div>

      {/* License Key Verification Bar */}
      <div className="mt-8 pt-6 border-t border-white/10">
        {status === 'verified' ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-base">
                ✓
              </span>
              <div>
                <span className="text-sm font-bold text-white block">License Verified Active</span>
                <span className="text-xs font-mono text-emerald-400">
                  {verifiedPlan} · Unlocked for macOS, Windows &amp; Linux
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Ready to activate in {currentOs.name}:</span>
              <code className="text-xs text-amber-300 font-mono bg-white/5 px-2 py-1 rounded">
                {currentOs.filename}
              </code>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <span className="text-xs font-mono text-slate-300 uppercase tracking-wider block">
                Verify License Key (Optional before download):
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                1 License covers macOS, Windows &amp; Linux
              </span>
            </div>
            <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <input
                type="text"
                placeholder="e.g. 49323daa-90ef-4157-90b9-... or MSH1-..."
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-black/60 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400 transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'verifying'}
                className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs transition-colors shrink-0 disabled:opacity-50"
              >
                {status === 'verifying' ? 'Verifying...' : `Unlock for ${currentOs.name}`}
              </button>
            </form>

            {status === 'error' && (
              <p className="text-xs text-rose-400 mt-2 font-mono">✕ {errorMessage}</p>
            )}
          </div>
        )}
      </div>

      {sha256 && (
        <div className="mt-4 pt-4 border-t border-white/5 font-mono text-[11px] text-slate-500 truncate flex items-center justify-between">
          <div>
            <span>Release Checksum (Apple Silicon):</span> <code className="text-slate-400">{sha256}</code>
          </div>
          <span className="text-slate-500">14-Day Offline Grace Period</span>
        </div>
      )}
    </div>
  );
}
