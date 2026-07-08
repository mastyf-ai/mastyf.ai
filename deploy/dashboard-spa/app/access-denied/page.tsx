import Link from 'next/link';
import { AccessDenied } from '../components/AccessDenied';

export default function AccessDeniedPage() {
  return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <AccessDenied message="You don't have permission to view this page. If you believe this is a mistake, contact your administrator." />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link href="/" className="text-sm">Return to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
