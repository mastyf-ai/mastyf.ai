import https from 'https';
import { URL } from 'url';
import { Logger } from './logger.js';

export interface TlsCheckResult {
  valid: boolean;
  daysUntilExpiry: number;
  issuer?: string;
  subject?: string;
  protocol?: string;
}

/**
 * Check TLS certificate validity for a given HTTPS URL.
 * Returns validity status, days until expiry, and certificate details.
 */
export async function checkTlsCert(url: string): Promise<TlsCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, daysUntilExpiry: 0 };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: true, daysUntilExpiry: Infinity, protocol: parsed.protocol };
  }

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        method: 'HEAD',
        timeout: 5000,
        rejectUnauthorized: false, // We want to inspect the cert, not fail
      },
      (res) => {
        const socket = res.socket as any;
        const cert = socket?.getPeerCertificate?.();
        
        if (!cert || Object.keys(cert).length === 0) {
          resolve({ valid: false, daysUntilExpiry: 0 });
          return;
        }

        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const now = Date.now();

        // Check if certificate is currently valid
        const isValid = validFrom && validTo
          ? now >= validFrom.getTime() && now <= validTo.getTime()
          : true;

        const days = validTo
          ? Math.floor((validTo.getTime() - now) / (1000 * 60 * 60 * 24))
          : 0;

        resolve({
          valid: isValid,
          daysUntilExpiry: days,
          issuer: cert.issuer?.O || cert.issuer?.CN,
          subject: cert.subject?.CN,
          protocol: 'TLS',
        });
      }
    );

    req.on('error', (err) => {
      Logger.debug(`TLS check failed for ${parsed.hostname}: ${err.message}`);
      resolve({ valid: false, daysUntilExpiry: 0 });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ valid: false, daysUntilExpiry: 0 });
    });

    req.end();
  });
}