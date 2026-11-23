'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { BrandLogo } from '../ui/BrandLogo';

/** Two-column frame shared by sign-in and first-run setup: the brand on the left, the form on the right. */
export function AuthFrame({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="true">
        <BrandLogo size={36} wordmark />
        <p className="auth-brand-line">Your model proposes. Mastyf decides.</p>
        <ul className="auth-brand-facts">
          <li>Every tool call your agents make is checked against your policy before it runs.</li>
          <li>Blocked calls never reach your files, shell or network.</li>
          <li>Every decision is recorded, so you can see what was tried and what was stopped.</li>
        </ul>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <BrandLogo size={32} className="auth-card-mark" />
          <h1 className="auth-title">{title}</h1>
          <div className="auth-intro">{intro}</div>
          {children}
        </div>
      </main>
    </div>
  );
}

type Os = 'windows' | 'mac' | 'linux';

function detectOs(): Os {
  if (typeof navigator === 'undefined') return 'windows';
  const p = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  return 'linux';
}

const SHOW_KEY: Record<Os, { label: string; command: string }> = {
  windows: { label: 'Windows (PowerShell)', command: 'Get-Content "$HOME\\.mastyf\\dashboard_api_key"' },
  mac: { label: 'macOS', command: 'cat ~/.mastyf/dashboard_api_key' },
  linux: { label: 'Linux', command: 'cat ~/.mastyf/dashboard_api_key' },
};

/** Where the key comes from and the one command that shows it, for the visitor's own OS. */
export function FindYourKey() {
  const [os, setOs] = useState<Os>(detectOs);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };
  const commands = [
    { label: 'From the Mastyf folder', command: 'pnpm dashboard:key' },
    { label: SHOW_KEY[os].label, command: SHOW_KEY[os].command },
  ];
  return (
    <details className="auth-help">
      <summary>Where do I find my API key?</summary>
      <p>
        Mastyf creates the key the first time you start it and saves it in a file called{' '}
        <code>dashboard_api_key</code> in the <code>.mastyf</code> folder of your home directory. Only you can read it.
        Run either command in a terminal and paste what it prints.
      </p>
      <div className="auth-os" role="tablist" aria-label="Your operating system">
        {(Object.keys(SHOW_KEY) as Os[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={os === id}
            className={`auth-os-tab${os === id ? ' active' : ''}`}
            onClick={() => setOs(id)}
          >
            {id === 'windows' ? 'Windows' : id === 'mac' ? 'macOS' : 'Linux'}
          </button>
        ))}
      </div>
      {commands.map((c) => (
        <div key={c.command} className="auth-cmd">
          <span className="auth-cmd-label">{c.label}</span>
          <code>{c.command}</code>
          <button
            type="button"
            className="auth-cmd-copy"
            onClick={() => void copy(c.command)}
            aria-label={`Copy: ${c.command}`}
          >
            {copied === c.command ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      ))}
    </details>
  );
}
