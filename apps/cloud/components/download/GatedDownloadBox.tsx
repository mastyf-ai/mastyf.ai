'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Download } from 'lucide-react';
import { formatPlanPrice } from '@/lib/billing/plans';

type Props = {
  initialSession: boolean;
  version: string;
  sha256: string;
  checkoutUrl: string;
};

type OperatingSystem = 'mac' | 'windows' | 'linux';

type Build = { arch: string; label: string };

interface OSDetails {
  id: OperatingSystem;
  name: string;
  archs: string;
  filename: string;
  notes: string;
  primary: Build;
  secondary: Build;
}

const OS_OPTIONS: Record<OperatingSystem, OSDetails> = {
  mac: {
    id: 'mac',
    name: 'macOS',
    archs: 'Apple Silicon (M1–M4) and Intel',
    filename: 'Mastyf-Shield-latest.dmg',
    notes: 'macOS 12 Monterey or newer. Works with Claude Desktop, Cursor, and Windsurf.',
    primary: { arch: 'arm64', label: 'Download for Apple Silicon (.dmg)' },
    secondary: { arch: 'x64', label: 'Intel Mac (.dmg)' },
  },
  windows: {
    id: 'windows',
    name: 'Windows',
    archs: 'Windows 10 and 11, x64 and ARM64',
    filename: 'Mastyf-Shield-Setup-latest.exe',
    notes: 'Installs a background service that mediates MCP traffic on port 4000.',
    primary: { arch: 'x64', label: 'Download installer (.exe)' },
    secondary: { arch: 'zip', label: 'Portable (.zip)' },
  },
  linux: {
    id: 'linux',
    name: 'Linux',
    archs: 'glibc 2.28+, x86_64 and arm64',
    filename: 'Mastyf-Shield-latest.AppImage',
    notes: 'Standalone AppImage, or a .deb package with a systemd user service.',
    primary: { arch: 'appimage', label: 'Download AppImage' },
    secondary: { arch: 'deb', label: 'Debian / Ubuntu (.deb)' },
  },
};

const OS_ORDER: OperatingSystem[] = ['mac', 'windows', 'linux'];

function detectOs(): OperatingSystem {
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'mac';
}

/**
 * Platform picker, download buttons, optional license check, and the release checksum.
 * Downloads are never gated: Shield asks for the key on first launch.
 */
export function GatedDownloadBox({ version, sha256, checkoutUrl }: Props) {
  const [selectedOs, setSelectedOs] = useState<OperatingSystem>('mac');
  const [detectedOs, setDetectedOs] = useState<OperatingSystem | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [verifiedPlan, setVerifiedPlan] = useState('');
  const [copied, setCopied] = useState(false);

  // Pick the visitor's platform on mount.
  useEffect(() => {
    const os = detectOs();
    setSelectedOs(os);
    setDetectedOs(os);
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) {
      setStatus('error');
      setErrorMessage('Enter your license key.');
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
        setErrorMessage(data.message || 'This key is invalid or has expired. Check it and try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Could not reach the license server. Check your connection and try again.');
    }
  };

  const copyChecksum = async () => {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const os = OS_OPTIONS[selectedOs];
  const downloadUrl = `/api/v1/download/shield?key=${encodeURIComponent(licenseKey.trim())}&os=${selectedOs}`;

  return (
    <div className="dl">
      <div className="dl__os" role="radiogroup" aria-label="Platform">
        {OS_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selectedOs === id}
            onClick={() => setSelectedOs(id)}
          >
            {OS_OPTIONS[id].name}
            {detectedOs === id ? (
              <span className="dl__detected" title="Detected from your browser">
                <span className="sr-only"> (detected)</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="dl__body">
        <p className="dl__name">
          Mastyf Shield {version} for {os.name}
        </p>
        <p className="dl__meta">{os.archs}</p>
        <div className="dl__buttons">
          <a className="btn btn-primary" href={`${downloadUrl}&arch=${os.primary.arch}`}>
            <Download size={15} strokeWidth={2} aria-hidden="true" />
            {os.primary.label}
          </a>
          <a className="btn" href={`${downloadUrl}&arch=${os.secondary.arch}`}>
            {os.secondary.label}
          </a>
        </div>
        <p className="dl__note">{os.notes}</p>
      </div>

      <div className="dl__key">
        {status === 'verified' ? (
          <p className="dl__ok" role="status">
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong>License active: {verifiedPlan}.</strong> It covers macOS, Windows and Linux. Install{' '}
              <code>{os.filename}</code> and paste the same key on first launch.
            </span>
          </p>
        ) : (
          <form onSubmit={handleVerify} noValidate>
            <label htmlFor="dl-key">License key</label>
            <p className="dl__key-hint" id="dl-key-hint">
              Optional here. Shield asks for it on first launch, then works offline for 14 days between checks.
            </p>
            <div className="dl__key-row">
              <input
                id="dl-key"
                type="text"
                placeholder="MG-…"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                aria-describedby="dl-key-hint"
                aria-invalid={status === 'error'}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn" disabled={status === 'verifying'}>
                {status === 'verifying' ? 'Verifying…' : 'Verify'}
              </button>
            </div>
            {status === 'error' ? (
              <p className="dl__msg dl__msg--error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="link-icon dl__buy">
              No key yet? Get Developer Pro, {formatPlanPrice('developer')} for 30 days
              <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </form>
        )}
      </div>

      {sha256 ? (
        <div className="dl__sum">
          <span>SHA-256, Apple Silicon</span>
          <code title={sha256}>{sha256}</code>
          <button
            type="button"
            className="icon-btn"
            onClick={copyChecksum}
            aria-label={copied ? 'Checksum copied' : 'Copy checksum'}
          >
            {copied ? (
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
