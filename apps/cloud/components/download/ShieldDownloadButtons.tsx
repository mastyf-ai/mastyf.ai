import { Download } from 'lucide-react';
import {
  SHIELD_PLATFORM_ORDER,
  SHIELD_PLATFORMS,
  SHIELD_VERSION,
  shieldDownloadPath,
  shieldPlatformAvailable,
} from '@/lib/billing/shield-builds';

/**
 * One-click downloads for a signed-in subscriber: plain links, because the route checks the
 * session. Only render this for someone whose plan is active.
 */
export function ShieldDownloadButtons() {
  return (
    <div className="dstack">
      {SHIELD_PLATFORM_ORDER.map((id) => {
        const platform = SHIELD_PLATFORMS[id];
        const available = shieldPlatformAvailable(id);
        return (
          <div key={id}>
            <p className="panel__text" style={{ margin: '0 0 6px' }}>
              <strong>{platform.name}</strong> <span className="dim">· {platform.requirements}</span>
            </p>
            {available ? (
              <>
                <div className="dl__buttons">
                  <a className="btn btn-primary btn-sm" href={shieldDownloadPath(id, platform.primary.arch)}>
                    <Download size={14} strokeWidth={2} aria-hidden="true" />
                    {platform.primary.label}
                  </a>
                  <a className="btn btn-sm" href={shieldDownloadPath(id, platform.secondary.arch)}>
                    {platform.secondary.label}
                  </a>
                </div>
                <p className="panel__text dim" style={{ margin: '6px 0 0' }}>
                  {platform.install}
                </p>
                {platform.primary.sha256 ? (
                  <p className="panel__text dim" style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>
                    SHA-256 ({platform.primary.label}): <code>{platform.primary.sha256}</code>
                  </p>
                ) : null}
              </>
            ) : (
              <span className="btn btn-sm" aria-disabled="true">
                Coming soon
              </span>
            )}
          </div>
        );
      })}
      <p className="panel__text dim" style={{ margin: 0 }}>
        Version {SHIELD_VERSION}. On first launch, Shield asks for your license key from the panel above.
      </p>
    </div>
  );
}
