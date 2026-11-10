import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailConfigured, sendEmail } from '@/lib/email';

const MAIL = { to: 'p@example.com', subject: 'Hello', text: 'code ABCD-2345', html: '<p>code ABCD-2345</p>' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sending email', () => {
  it('needs a provider key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(emailConfigured()).toBe(false);
    expect(await sendEmail(MAIL)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the message to the one recipient', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendEmail(MAIL)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['p@example.com'], subject: 'Hello', text: MAIL.text });
  });

  it.each([
    ['the provider refuses', async () => new Response('{}', { status: 422 })],
    ['the provider cannot be reached', async () => { throw new Error('down'); }],
  ])('reports failure when %s, without logging the message', async (_label, reply) => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal('fetch', vi.fn(reply));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendEmail(MAIL)).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain('ABCD-2345');
  });
});
