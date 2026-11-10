/** Sends one email through Resend. Message bodies can hold join codes, so they are never logged. */

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

const DEFAULT_FROM = 'Mastyf <noreply@mastyf.ai>';
const TIMEOUT_MS = 10_000;

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendEmail(mail: OutgoingEmail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  try {
    const res = await fetch(process.env.RESEND_API_URL?.trim() || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error('[email] the provider refused a message', res.status);
    return res.ok;
  } catch {
    console.error('[email] could not reach the provider');
    return false;
  }
}
