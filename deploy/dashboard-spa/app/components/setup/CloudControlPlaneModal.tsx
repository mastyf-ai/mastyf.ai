'use client';

import { Cloud } from 'lucide-react';
import { Button } from '../ui/Button';
import { CloudConnectionInfo } from './CloudConnectionInfo';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Kept for callers; the link is made with environment variables, so there is nothing to confirm here. */
  onConnected?: () => void;
  onAction?: (msg: string) => void;
};

/** How to link this install to a mastyf.ai workspace, and whether it is linked now. */
export function CloudControlPlaneModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="setup-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="setup-modal cloud-control-plane-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="setup-modal-head">
          <Cloud size={20} aria-hidden />
          <h2 id="cloud-modal-title">Link to mastyf.ai</h2>
        </header>
        <CloudConnectionInfo />
        <footer className="setup-modal-foot">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}
