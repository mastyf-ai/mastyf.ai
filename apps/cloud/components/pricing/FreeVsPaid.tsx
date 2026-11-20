import Link from 'next/link';
import { FREE_FEATURES, PAID_FEATURES, type TierFeature } from '@/lib/tier-features';

function FeatureName({ feature }: { feature: TierFeature }) {
  if (!feature.href) return <>{feature.name}</>;
  if (feature.href.startsWith('http')) {
    return (
      <a href={feature.href} target="_blank" rel="noopener noreferrer">
        {feature.name}
      </a>
    );
  }
  return <Link href={feature.href}>{feature.name}</Link>;
}

export function FeatureList({ items }: { items: TierFeature[] }) {
  return (
    <ul className="fvp__list">
      {items.map((f) => (
        <li key={f.name}>
          <span className="fvp__name">
            <FeatureName feature={f} />
            {f.status === 'coming' ? <span className="fvp__soon">Coming</span> : null}
          </span>
          <span className="fvp__what">{f.what}</span>
        </li>
      ))}
    </ul>
  );
}

/** Free versus paid, side by side: what each tier gets and where it runs. */
export function FreeVsPaid({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  const Head = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <section className="section fvp" id="free-vs-paid" aria-labelledby="fvp-title">
      <Title id="fvp-title" className="section__title">
        What&rsquo;s free and what&rsquo;s paid
      </Title>
      <div className="fvp__cols">
        <div className="fvp__col">
          <Head className="fvp__head">Free</Head>
          <p className="fvp__where">Runs on your own machines and servers. No account needed.</p>
          <FeatureList items={FREE_FEATURES} />
        </div>
        <div className="fvp__col fvp__col--paid">
          <Head className="fvp__head">Paid</Head>
          <p className="fvp__where">The Mastyf Shield app and Mastyf&rsquo;s servers. Everything in Free, plus:</p>
          <FeatureList items={PAID_FEATURES} />
        </div>
      </div>
    </section>
  );
}
