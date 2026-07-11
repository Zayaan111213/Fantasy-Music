// Thin Resend client. All email leaves the app through sendEmail(); it never
// throws — callers branch on the SendResult so a mail outage can't take down
// a pipeline or request handler.

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Bandwagon <onboarding@resend.dev>';

export type SendResult =
  | { status: 'sent'; id?: string }
  | { status: 'skipped' } // no RESEND_API_KEY configured
  | { status: 'failed'; permanent: boolean; detail: string };

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: EmailInput): Promise<SendResult> {
  // Read env at call time (not module load) so tests and late-configured
  // environments behave predictably.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — skipping send to ${input.to}`);
    return { status: 'skipped' };
  }
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });

    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { status: 'sent', id: body.id };
    }

    const detail = `Resend ${res.status}: ${await res.text().catch(() => '')}`;
    // 429 = rate limited (retry next tick). Other 4xx are permanent: bad key,
    // unverified-domain 403, invalid recipient — retrying is futile.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { status: 'failed', permanent, detail };
  } catch (err) {
    return { status: 'failed', permanent: false, detail: `network error: ${err}` };
  }
}
