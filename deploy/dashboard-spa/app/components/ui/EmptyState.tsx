import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

type Props = {
  icon?: LucideIcon;
  title: string;
  message?: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
};

export function EmptyState({ icon: Icon, title, message, children, action }: Props) {
  return (
    <div className="empty-state" role="status">
      {Icon && <div className="empty-state-icon"><Icon size={32} /></div>}
      <p className="empty-state-title">{title}</p>
      {message && <p className="empty-state-message">{message}</p>}
      {children}
      {action && (
        <div className="empty-state-action">
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}
