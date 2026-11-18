import { Metadata } from 'next';
import Image from 'next/image';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { IIT_KGP } from '@/lib/iit-kharagpur';
import { safeAuth } from '@/lib/safe-auth';
import './iit-kharagpur.css';

export const metadata: Metadata = {
  title: 'Backed by IIT Kharagpur — Mastyf',
  description: `Mastyf.ai was selected for ${IIT_KGP.amount} in support under the ${IIT_KGP.scheme}.`,
};

export default async function IitKharagpurPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head iitkgp-head">
          <div className="iitkgp-head__text">
            <p className="eyebrow">Funding</p>
            <h1 className="page-head__title">Backed by IIT Kharagpur</h1>
            <p className="page-head__lead">
              Mastyf.ai was selected for {IIT_KGP.amount} ({IIT_KGP.amountWords}) in support under the{' '}
              {IIT_KGP.scheme}, after a jury evaluation by the Institute&apos;s {IIT_KGP.office.replace(', IIT Kharagpur', '')}.
            </p>
          </div>
          <div className="iitkgp-mark" aria-label="IIT Kharagpur">
            {IIT_KGP.logo ? (
              <Image src={IIT_KGP.logo} alt="IIT Kharagpur" width={180} height={180} className="iitkgp-mark__logo" />
            ) : (
              <span className="iitkgp-mark__word" aria-hidden="true">
                <span>IIT</span>
                <span>Kharagpur</span>
              </span>
            )}
          </div>
        </header>

        <section className="section section--flush-top" aria-label="The award">
          <dl className="facts iitkgp-facts">
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
        </section>

        <section className="section iitkgp-body" aria-labelledby="iitkgp-how">
          <h2 id="iitkgp-how">How the support is made up</h2>
          <ul className="iitkgp-parts">
            <li>
              <h3>Grant · half</h3>
              <p>From IIT Kharagpur&apos;s Institute of Eminence funds, for Mastyf&apos;s running costs.</p>
            </li>
            <li>
              <h3>Seed capital · half</h3>
              <p>From the Institute&apos;s Innovation &amp; Entrepreneurship Seed Fund, for building the product.</p>
            </li>
          </ul>
          <p className="iitkgp-note">
            The selection followed a presentation to the Seed Fund jury and a review by the {IIT_KGP.office}.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
