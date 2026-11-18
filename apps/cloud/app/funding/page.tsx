import { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { IIT_KGP } from '@/lib/iit-kharagpur';
import { safeAuth } from '@/lib/safe-auth';
import './funding.css';

export const metadata: Metadata = {
  title: 'Funding and support — Mastyf',
  description: `Who backs Mastyf Labs, including ${IIT_KGP.amount} in support under the ${IIT_KGP.scheme}.`,
};

export default async function FundingPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <p className="eyebrow">Mastyf Labs</p>
          <h1 className="page-head__title">Funding and support</h1>
          <p className="page-head__lead">The institutions and programmes that back Mastyf&apos;s work.</p>
        </header>

        <section className="section section--flush-top funding-backer" id="iit-kharagpur" aria-labelledby="iit-kharagpur-title">
          <div className="funding-backer__head">
            <div className="funding-backer__text">
              <p className="eyebrow">Seed fund</p>
              <h2 id="iit-kharagpur-title">IIT Kharagpur</h2>
              <p className="funding-backer__lead">
                Mastyf.ai was selected for {IIT_KGP.amount} ({IIT_KGP.amountWords}) in support under the {IIT_KGP.scheme},
                after a presentation to the Seed Fund jury and a review by the {IIT_KGP.office}.
              </p>
            </div>
            <div className="funding-mark">
              {/* A plain img: the emblem is an SVG and needs no resizing. */}
              <img src={IIT_KGP.logo} alt="Indian Institute of Technology Kharagpur emblem" width={160} height={179} />
            </div>
          </div>

          <dl className="facts funding-facts">
            <div>
              <dt>Scheme</dt>
              <dd>{IIT_KGP.scheme}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{IIT_KGP.amount}</dd>
            </div>
            <div>
              <dt>Awarded</dt>
              <dd>{IIT_KGP.awarded}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{IIT_KGP.reference}</dd>
            </div>
          </dl>

          <h3 className="funding-sub">How the support is made up</h3>
          <ul className="funding-parts">
            <li>
              <h4>Grant · half</h4>
              <p>From IIT Kharagpur&apos;s Institute of Eminence funds, for Mastyf&apos;s running costs.</p>
            </li>
            <li>
              <h4>Seed capital · half</h4>
              <p>From the Institute&apos;s Innovation &amp; Entrepreneurship Seed Fund, for building the product.</p>
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
