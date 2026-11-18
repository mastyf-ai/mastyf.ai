import { Metadata } from 'next';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { FOUNDERS, FOUNDERS_INTRO, initials } from '@/lib/founders';
import { safeAuth } from '@/lib/safe-auth';
import './founders.css';

export const metadata: Metadata = {
  title: 'Founders — Mastyf',
  description: 'The people who started Mastyf Labs.',
};

export default async function FoundersPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <p className="eyebrow">Mastyf Labs</p>
          <h1 className="page-head__title">Founders</h1>
          <p className="page-head__lead">{FOUNDERS_INTRO}</p>
        </header>

        <ul className="founders" aria-label="Founders">
          {FOUNDERS.map((f, i) => (
            <li key={`${f.name}-${i}`} className={`founder${f.placeholder ? ' founder--placeholder' : ''}`}>
              <div className="founder__photo" aria-hidden={!f.photo}>
                {f.photo ? (
                  <Image src={f.photo} alt={f.name} width={96} height={96} />
                ) : (
                  <span className="founder__initials">{initials(f.name)}</span>
                )}
              </div>
              <div className="founder__text">
                <h2 className="founder__name">{f.name}</h2>
                <p className="founder__role">{f.role}</p>
                <p className="founder__bio">{f.bio}</p>
                {f.links && f.links.length > 0 && (
                  <ul className="founder__links">
                    {f.links.map((l) => (
                      <li key={l.href}>
                        <a href={l.href} target="_blank" rel="noopener noreferrer">
                          {l.label}
                          <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {f.placeholder && <p className="founder__draft">Placeholder: content to be added</p>}
              </div>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
