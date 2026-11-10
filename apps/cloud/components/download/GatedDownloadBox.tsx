'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Download } from 'lucide-react';
import {
  SHIELD_PLATFORM_ORDER,
  SHIELD_PLATFORMS,
  SHIELD_VERSION,
  type ShieldBuild,
  type ShieldPlatform,
  shieldDownloadPath,
  shieldPlatformAvailable,
} from '@/lib/billing/shield-builds';

type Props = {
  /** Signed in with an active plan: downloads need nothing else. */
  entitled: boolean;
  signedIn: boolean;
  checkoutUrl: string;
};

function detectPlatform(): ShieldPlatform {
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'mac';
}

/**
 * Platform picker and downloads, for paid plans only. A signed-in subscriber gets plain links; anyone
 * else signs in, buys, or enters a key, which is sent in a request body and never put in a URL.
 */
export function GatedDownloadBox({ entitled, signedIn, checkoutUrl }: Props) {
  const [selected, setSelected] = useState<ShieldPlatform>('windows');
  const [detected, setDetected] = useState<ShieldPlatform | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'downloading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const platform = detectPlatform();
    setSelected(platform);
    setDetected(platform);
  }, []);

  const platform = SHIELD_PLATFORMS[selected];
  const available = shieldPlatformAvailable(selected);
  const keyVerified = status === 'verified' || status === 'downloading';

  const verifyKey = async (e: React.FormEvent) => {
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
      } else {
        setStatus('error');
        setErrorMessage(data.message || 'This key is invalid or has expired. Check it and try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Could not reach the license server. Check your connection and try again.');
    }
  };

  /** Asks for a short-lived link with the key in the body, then starts the download. */
  const downloadWithKey = async (build: ShieldBuild) => {
    setStatus('downloading');
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/download/shield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim(), os: selected, arch: build.arch }),
      });
      const data = await res.json();
      if (res.ok && data.downloadUrl) {
        window.location.assign(data.downloadUrl);
        setStatus('verified');
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Could not start the download. Try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Could not reach Mastyf. Check your connection and try again.');
    }
  };

  const copyChecksum = async (sha256: string) => {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const downloadButton = (build: ShieldBuild, primary: boolean) => {
    const className = primary ? 'btn btn-primary' : 'btn';
    const icon = primary ? <Download size={15} strokeWidth={2} aria-hidden="true" /> : null;
    if (entitled) {
      return (
        <a className={className} href={shieldDownloadPath(selected, build.arch)}>
          {icon}
          {build.label}
        </a>
      );
    }
    return (
      <button type="button" className={className} onClick={() => downloadWithKey(build)} disabled={status === 'downloading'}>
        {icon}
        {build.label}
      </button>
    );
  };

  return (
    <div className="dl">
      <div className="dl__os" role="radiogroup" aria-label="Platform">
        {SHIELD_PLATFORM_ORDER.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={selected === id} onClick={() => setSelected(id)}>
            {SHIELD_PLATFORMS[id].name}
            {detected === id ? (
              <span className="dl__detected" title="Detected from your browser">
                <span className="sr-only"> (detected)</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="dl__body">
        <p className="dl__name">
          Mastyf Shield {SHIELD_VERSION} for {platform.name}
        </p>
        <p className="dl__meta">{platform.requirements}</p>
        <div className="dl__buttons">
          {!available ? (
            <span className="btn" aria-disabled="true">
              Coming soon
            </span>
          ) : entitled || keyVerified ? (
            <>
              {downloadButton(platform.primary, true)}
              {platform.secondary ? downloadButton(platform.secondary, false) : null}
            </>
          ) : signedIn ? (
            <a className="btn btn-primary" href={checkoutUrl}>
              Get a plan to download
            </a>
          ) : (
            <a className="btn btn-primary" href="/login?callbackUrl=%2Fdownload">
              Sign in to download
            </a>
          )}
        </div>
        <p className="dl__note">
          {available
            ? platform.install
            : `Shield for ${platform.name} is on its way. Your plan will cover it when it ships.`}
        </p>
      </div>

      <div className="dl__key">
        {entitled ? (
          <p className="dl__ok" role="status">
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong>Your plan is active.</strong> Shield asks for your license key on first launch. It is on your{' '}
              <a href="/dashboard/license">License page</a>.
            </span>
          </p>
        ) : keyVerified ? (
          <p className="dl__ok" role="status">
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong>License active.</strong> Download above, then paste the same key on first launch.
            </span>
          </p>
        ) : (
          <form onSubmit={verifyKey} noValidate>
            <label htmlFor="dl-key">Have a license key?</label>
            <p className="dl__key-hint" id="dl-key-hint">
              Enter it to download without signing in, for example on another computer.
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
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="link-icon dl__buy">
              No key yet? See the plans
              <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </form>
        )}
        {status === 'error' ? (
          <p className="dl__msg dl__msg--error" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {available && platform.primary.sha256 ? (
        <div className="dl__sum">
          <span>SHA-256, {platform.primary.label}</span>
          <code title={platform.primary.sha256}>{platform.primary.sha256}</code>
          <button
            type="button"
            className="icon-btn"
            onClick={() => copyChecksum(platform.primary.sha256!)}
            aria-label={copied ? 'Checksum copied' : 'Copy checksum'}
          >
            {copied ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
