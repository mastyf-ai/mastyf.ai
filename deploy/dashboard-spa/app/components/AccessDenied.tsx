'use client';

import { ShieldOff } from 'lucide-react';
import { Card } from './ui/Card';

export function AccessDenied({ message }: { message?: string }) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0', textAlign: 'center' }}>
        <ShieldOff size={28} className="text-muted" />
        <h3 className="card-title" style={{ marginBottom: 0 }}>Access denied</h3>
        <p className="text-sm text-muted" style={{ maxWidth: 360 }}>
          {message || "You don't have permission to view this section. Contact an administrator if you believe this is a mistake."}
        </p>
      </div>
    </Card>
  );
}
