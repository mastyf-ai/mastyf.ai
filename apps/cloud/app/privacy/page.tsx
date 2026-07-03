import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import '../landing.css';

export default function PrivacyPage() {
  return (
    <div className="landing">
      <SiteNav session={false} />
      <main className="container" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>
        <h1>Privacy Policy</h1>
        <div className="card">
          <p>
            We collect account information from Google or GitHub OAuth (email, name, profile image)
            to operate your organization on the optional cloud control plane.
          </p>
          <p>
            Policy YAML and API key metadata are stored in our database to provide the control
            plane. You may request deletion by contacting{' '}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
        <Link href="/">Back to home</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
