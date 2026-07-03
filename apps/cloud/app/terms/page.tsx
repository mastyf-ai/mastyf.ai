import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { CLOUD_NAME, SITE_NAME } from '@/lib/product-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import '../landing.css';

export default function TermsPage() {
  return (
    <div className="landing">
      <SiteNav session={false} />
      <main className="container" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>
        <h1>Terms of Service</h1>
        <div className="card">
          <p>
            {CLOUD_NAME} provides a hosted platform for MCP package security scores, trust badges,
            and a cloud console for managing policies, API keys, and fleet configuration. The sign-in
            is free.
          </p>
          <p>
            The service is provided as-is. You are responsible for your use of {SITE_NAME} and any
            API keys you generate.
          </p>
          <p>
            For support, contact <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
        <Link href="/">Back to home</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
