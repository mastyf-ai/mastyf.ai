import type { IncomingMessage, ServerResponse } from 'http';

export interface HttpProxyAuthValidator {
  getConfig(): { required: boolean };
  validate(token: string): Promise<{ valid: boolean; error?: string }>;
  extractToken?(authHeader: string | undefined): string | null;
}

function defaultExtractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(\S.*)$/i);
  return match?.[1]?.trim() || null;
}

export type AuthGateResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

export async function runHttpProxyAuthGate(
  req: IncomingMessage,
  validator: HttpProxyAuthValidator,
): Promise<AuthGateResult> {
  const authHeader = req.headers['authorization'];
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const extract = validator.extractToken ?? defaultExtractToken;
  const token = extract(headerValue);

  if (!token && validator.getConfig().required) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }

  if (token) {
    const result = await validator.validate(token);
    if (!result.valid && validator.getConfig().required) {
      return {
        ok: false,
        status: 403,
        message: `Authentication failed: ${result.error ?? 'invalid token'}`,
      };
    }
  }

  return { ok: true };
}

export function sendAuthGateFailure(res: ServerResponse, failure: Extract<AuthGateResult, { ok: false }>): void {
  if (res.headersSent) return;
  res.writeHead(failure.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: failure.message }));
}
