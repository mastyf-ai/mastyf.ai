import { createHash, createHmac } from 'crypto';

/** How long a download link works. Long enough to start a download, short enough that sharing one is pointless. */
const LINK_SECONDS = 300;

/** The object for a platform. These are the only files a download can reach. */
export function shieldObjectKey(os?: string, arch?: string): string {
  const platform = (os || '').toLowerCase();
  const variant = (arch || '').toLowerCase();
  if (platform === 'win' || platform === 'windows') {
    return variant === 'zip' ? 'latest/Mastyf-Shield-win-x64.zip' : 'latest/Mastyf-Shield-Setup-latest.exe';
  }
  if (platform === 'linux') {
    return variant === 'deb' ? 'latest/Mastyf-Shield-latest.deb' : 'latest/Mastyf-Shield-latest.AppImage';
  }
  if (variant === 'x64' || variant === 'intel') return 'latest/Mastyf-Shield-latest-x64.dmg';
  return 'latest/Mastyf-Shield-latest-arm64.dmg';
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** An expiring S3 link, signed with AWS Signature V4. Null when storage isn't configured. */
export function presignShieldDownload(objectKey: string, now = new Date()): string | null {
  const bucket = process.env.SHIELD_S3_BUCKET?.trim();
  const region = process.env.SHIELD_S3_REGION?.trim();
  const accessKey = process.env.SHIELD_S3_ACCESS_KEY_ID?.trim();
  const secretKey = process.env.SHIELD_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !region || !accessKey || !secretKey) return null;

  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = `/${objectKey.split('/').map(encode).join('/')}`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKey}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(LINK_SECONDS)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${k}=${encode(v)}`)
    .sort()
    .join('&');
  const canonical = ['GET', path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(canonical, 'utf8').digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), 's3'), 'aws4_request');
  return `https://${host}${path}?${query}&X-Amz-Signature=${hmac(signingKey, toSign).toString('hex')}`;
}
