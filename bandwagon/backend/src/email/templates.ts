// Email subjects + shared layout for personal Notification rows. The
// Notification.message copy is already written for humans, so the email body
// is just that message inside a minimal branded wrapper.

const SUBJECTS: Record<string, string> = {
  trade_proposed: 'You have a new trade offer',
  trade_accepted: 'Your trade offer was accepted',
  trade_rejected: 'Your trade offer was rejected',
  trade_cancelled: 'A trade involving you was cancelled',
  trade_vetoed: 'Your trade was vetoed by the league',
  trade_executed: 'Your trade went through',
  trade_failed: 'Your trade could not be completed',
  waiver_result: 'Your waiver claim results are in',
  lineup_reminder: 'New week — set your lineup before Tuesday',
  league_deleted: 'One of your leagues was deleted',
  league_renewed: 'Your league is back for a new season',
};

const FALLBACK_SUBJECT = 'Bandwagon update';

export function subjectFor(type: string): string {
  return SUBJECTS[type] ?? FALLBACK_SUBJECT;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderInput {
  username: string | null;
  message: string;
  cta?: { url: string; label: string }; // defaults to the app-root "Open Bandwagon" button
  footer?: string;
}

export function renderEmail({ username, message, cta, footer }: RenderInput): { html: string; text: string } {
  const appUrl = process.env.FRONTEND_URL || 'https://bandwagon.up.railway.app';
  const button = cta ?? { url: appUrl, label: 'Open Bandwagon' };
  const footerText = footer ?? "You're receiving this because of activity in your Bandwagon league.";
  const greeting = `Hi ${username ?? 'there'},`;
  // message/username include user-controlled team and league names — escape them.
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="background:#18181b;padding:20px 32px;">
        <span style="color:#fafafa;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Bandwagon</span>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;color:#18181b;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
        <p style="margin:0;">${escapeHtml(message)}</p>
      </td></tr>
      <tr><td style="padding:20px 32px 28px;">
        <a href="${button.url}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">${escapeHtml(button.label)}</a>
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f4f4f7;color:#71717a;font-size:12px;line-height:1.5;">
        ${escapeHtml(footerText)}
      </td></tr>
    </table>
  </td></tr>
</table>`.trim();
  const text = `${greeting}\n\n${message}\n\n${button.url}`;
  return { html, text };
}
