import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendEmail } from '../../email/mailer';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const input = {
  to: 'user@example.com',
  subject: 'Test subject',
  html: '<p>hi</p>',
  text: 'hi',
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  // sendEmail hard-skips under NODE_ENV=test (so e2e never sends real mail);
  // pretend we're in a real environment to exercise the send path.
  vi.stubEnv('NODE_ENV', 'development');
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendEmail', () => {
  it('posts to Resend and returns sent on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'email-123' }));
    const result = await sendEmail(input);
    expect(result).toEqual({ status: 'sent', id: 'email-123' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      from: 'Bandwagoner <onboarding@resend.dev>', // default when EMAIL_FROM unset
      to: ['user@example.com'],
      subject: 'Test subject',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('uses EMAIL_FROM when set', async () => {
    vi.stubEnv('EMAIL_FROM', 'Bandwagon <noreply@bandwagon.fm>');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await sendEmail(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe('Bandwagon <noreply@bandwagon.fm>');
  });

  it('treats 403 (unverified domain) as permanent failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'domain not verified' }));
    const result = await sendEmail(input);
    expect(result).toMatchObject({ status: 'failed', permanent: true });
  });

  it('treats 422 as permanent failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422));
    await expect(sendEmail(input)).resolves.toMatchObject({ status: 'failed', permanent: true });
  });

  it('treats 429 (rate limit) as transient', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429));
    await expect(sendEmail(input)).resolves.toMatchObject({ status: 'failed', permanent: false });
  });

  it('treats 500 as transient', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500));
    await expect(sendEmail(input)).resolves.toMatchObject({ status: 'failed', permanent: false });
  });

  it('treats a network error as transient and never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(sendEmail(input)).resolves.toMatchObject({ status: 'failed', permanent: false });
  });

  it('skips without calling fetch when RESEND_API_KEY is unset', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const result = await sendEmail(input);
    expect(result).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips under NODE_ENV=test even with a key configured', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const result = await sendEmail(input);
    expect(result).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
