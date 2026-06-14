type Props = {
  status?: string;
  statusIsError?: boolean;
};

export function DashboardShell({ status = 'Loading…', statusIsError = false }: Props) {
  return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 48 }}>
        <div className="card" style={{ padding: 32, maxWidth: 400, margin: '0 auto' }}>
          <div className="sidebar-logo" style={{ margin: '0 auto 16px' }}>G</div>
          <p className={`text-sm ${statusIsError ? 'text-danger' : 'text-muted'}`}>
            {status}
          </p>
          <div
            style={{
              marginTop: 24,
              height: 8,
              maxWidth: 240,
              margin: '24px auto 0',
              background: 'var(--bg-muted)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: 'var(--brand-primary)',
                borderRadius: 4,
                animation: 'pulse-dot 1.2s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
