'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { SITE_NAME } from '@/lib/product-links';

const FAQ_ITEMS = [
  {
    q: `What is ${SITE_NAME}?`,
    a: 'It checks every action an AI agent takes before it runs: each tool call on its way out, and each tool result before the model reads it. Anything your rules don’t allow is stopped.',
  },
  {
    q: 'Is it free?',
    a: 'The checks are free and run on your own machine: the Python library, the check program and the GitHub Copilot hooks. No account, and nothing is sent to Mastyf. The paid plans add the Shield app for desktop agents and Mastyf’s paid checks, such as Protocol X.',
  },
  {
    q: 'Do I need an account?',
    a: 'Not for the free checks. Shield needs a paid plan and a licence key, which appears on your dashboard after payment.',
  },
  {
    q: 'Does Mastyf see my data?',
    a: 'The free checks send nothing to Mastyf. Shield keeps every call on your PC and sends one redacted record per call to your workspace; full arguments never leave your PC. Protocol X checks are sent to Mastyf’s servers and not stored. Shield doesn’t read your conversations with the model.',
  },
  {
    q: 'Which agents does it work with?',
    a: 'Python agents built with LangChain, LangGraph, the OpenAI Agents SDK or your own loop; any agent in any language through the local check API; any MCP server; GitHub Copilot’s coding agent; and, with Shield, Claude Code, Cursor, VS Code, Windsurf, Cline and Claude Desktop. The docs page “Find your agent” lists them all.',
  },
  {
    q: 'What happens if Mastyf can’t check a call?',
    a: 'It is blocked. Every way of connecting fails closed by default. The Python library lets you choose to allow unchecked calls instead, with a warning each time.',
  },
  {
    q: 'Does Shield run on macOS or Linux?',
    a: 'Not yet. Shield runs on Windows 10 (build 19041 or later) and Windows 11. The free checks run on Windows, macOS and Linux.',
  },
  {
    q: 'Why does Windows warn me about the installer?',
    a: 'Shield isn’t code-signed yet. Download it only from mastyf.ai and compare its SHA-256 with the one on the download page; then choose More info, then Run anyway. Never run a copy from anywhere else.',
  },
  {
    q: 'How do I get help?',
    a: 'Email mastyf.support@gmail.com, or open an issue on GitHub. A person reads every message.',
  },
];

/** The FAQ accordion on its own, for the docs page. */
export function FaqList() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="faq">
      {FAQ_ITEMS.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.q} className={`faq__item${open ? ' is-open' : ''}`}>
            <h3 className="faq__q">
              <button
                type="button"
                id={`faq-q-${i}`}
                aria-expanded={open}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                {item.q}
                {open ? (
                  <Minus size={15} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>
            </h3>
            {open ? (
              <div className="faq__a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
                <p>{item.a}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="section__grid">
        <div className="section__aside">
          <h2 id="faq-title">Your questions, answered</h2>
        </div>
        <FaqList />
      </div>
    </section>
  );
}
