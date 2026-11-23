import { BrandLogo } from './ui/BrandLogo';

type Props = {
  status?: string;
  statusIsError?: boolean;
};

/** Shown while the dashboard loads or checks the session. */
export function DashboardShell({ status = 'Loading', statusIsError = false }: Props) {
  return (
    <div className="boot" role="status" aria-live="polite">
      <BrandLogo size={44} />
      <p className={statusIsError ? 'boot-text error' : 'boot-text'}>{status}</p>
      {!statusIsError && <span className="boot-bar" aria-hidden="true"><span /></span>}
    </div>
  );
}
