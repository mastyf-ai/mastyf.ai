'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { ThreatDiscoveryStatus } from '@/lib/mastyf-ai-api';

type Llm = ThreatDiscoveryStatus['llm'];

const INSTALL = {
  windows: 'winget install Ollama.Ollama',
  mac: 'brew install ollama',
  linux: 'curl -fsSL https://ollama.com/install.sh | sh',
};

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="lab-cmd">
      <code>{text}</code>
      <button
        type="button"
        aria-label={`Copy ${text}`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/**
 * What a new user still has to do before Threat Lab can run. Checks again by itself, so the steps tick
 * off while the person works through them in a terminal.
 */
export function OllamaSetup({ llm, onCheck, nudge }: { llm: Llm | null | undefined; onCheck: () => void; nudge: number }) {
  const ref = useRef<HTMLElement>(null);
  const [os, setOs] = useState<keyof typeof INSTALL>('windows');
  const missing = !!llm && !llm.ok;

  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'windows' : 'linux');
  }, []);
  useEffect(() => {
    if (!missing) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') onCheck(); }, 6000);
    return () => window.clearInterval(t);
  }, [missing, onCheck]);
  useEffect(() => {
    if (nudge === 0) return;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ref.current?.focus({ preventScroll: true });
  }, [nudge]);

  if (!missing) return null;
  const model = llm.model || 'qwen3:8b';
  if (llm.state === 'disabled') {
    return <section ref={ref} tabIndex={-1} className="lab-needs" role="status"><strong>The local model is turned off.</strong><p>{llm.reason}</p></section>;
  }
  const installed = llm.state !== 'not-installed';
  const running = llm.state === 'model-missing';
  const steps = [
    { done: installed, title: 'Install Ollama', body: <><Command text={INSTALL[os]} /> or download it from <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com</a>.</> },
    { done: running, title: 'Start it', body: <>Open the Ollama app, or run <Command text="ollama serve" /> and leave it open.</> },
    { done: false, title: `Download the model ${model}`, body: <><Command text={`ollama pull ${model}`} /> This is a download of several gigabytes and happens once.</> },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <section ref={ref} tabIndex={-1} key={nudge} className={`lab-needs${nudge ? ' nudge' : ''}`} aria-labelledby="lab-needs-title">
      <strong id="lab-needs-title">Threat Lab needs Ollama on this computer</strong>
      <p>
        Threat Lab and Auto Research use a local AI model to invent new attacks and test your policy with them. The model runs on
        your own machine through Ollama, which is free. Nothing is sent anywhere.
      </p>
      <ol className="lab-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : i === next ? 'next' : ''}>
            <span className="lab-step-mark" aria-hidden="true">{s.done ? <Check size={13} /> : i + 1}</span>
            <div>
              <span className="lab-step-title">{s.title}{s.done ? ' (done)' : ''}</span>
              {!s.done && <div className="lab-step-body">{s.body}</div>}
            </div>
          </li>
        ))}
      </ol>
      <p className="lab-foot" role="status">
        This page checks again every few seconds.{' '}
        <button type="button" className="lab-check" onClick={onCheck}>Check now</button> Run Analysis under Swarm Analysis works
        without a model.
      </p>
    </section>
  );
}
