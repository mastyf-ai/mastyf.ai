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
          <h1 className="page-head__title">Funding and support</h1>
          <p className="page-head__lead">The institutions and programmes that back Mastyf&apos;s work.</p>
        </header>

        <section className="section section--flush-top funding-backer" id="iit-kharagpur" aria-labelledby="iit-kharagpur-title">
          <div className="funding-backer__head">
            <div className="funding-backer__text">
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

          {/* The award as one picture: the total, and the bar it splits into. */}
          <div className="funding-split" aria-label={`${IIT_KGP.amount}, half grant and half seed capital`}>
            <p className="funding-split__total">{IIT_KGP.amount}</p>
            <div className="funding-split__bar" aria-hidden="true">
              <span className="funding-split__part funding-split__part--grant" />
              <span className="funding-split__part funding-split__part--seed" />
            </div>
            <ul className="funding-split__legend">
              <li>
                <strong>Half grant</strong>
                <span>Institute of Eminence funds, for running costs</span>
              </li>
              <li>
                <strong>Half seed capital</strong>
                <span>Innovation &amp; Entrepreneurship Seed Fund, for building the product</span>
              </li>
            </ul>
          </div>

          <p className="funding-ref">
            Awarded {IIT_KGP.awarded}, reference {IIT_KGP.reference}.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
