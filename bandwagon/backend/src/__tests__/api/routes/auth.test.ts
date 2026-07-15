import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// All mocks hoisted before any import that might trigger module execution

vi.mock('../../../db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    passwordResetToken: { updateMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../api/middleware/upload', () => ({
  uploadAvatar: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../email/mailer', () => ({
  sendEmail: vi.fn(),
}));

import { prisma } from '../../../db/prisma';
import { sendEmail } from '../../../email/mailer';
import { errorHandler } from '../../../api/middleware/errorHandler';
import authRouter from '../../../api/routes/auth';

const pm = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};
const sendEmailMock = vi.mocked(sendEmail);

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
app.use(errorHandler);

const USER = {
  id: 'user-1',
  email: 'fan@example.com',
  passwordHash: 'old-hash',
  username: 'ChartFan',
  avatarUrl: null,
};

function sha256(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ status: 'sent' });
  pm.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  pm.passwordResetToken.create.mockResolvedValue({});
  pm.$transaction.mockResolvedValue([]);
});

describe('POST /auth/forgot-password', () => {
  it('404 for an email with no account, without sending anything', async () => {
    pm.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No account found with that email');
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(pm.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('400 for a malformed email', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(pm.user.findUnique).not.toHaveBeenCalled();
  });

  it('invalidates old tokens, stores only a hash, and emails a link with the raw token', async () => {
    pm.user.findUnique.mockResolvedValue(USER);
    const res = await request(app).post('/auth/forgot-password').send({ email: USER.email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(pm.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    const created = pm.passwordResetToken.create.mock.calls[0][0].data;
    expect(created.userId).toBe(USER.id);
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const email = sendEmailMock.mock.calls[0][0];
    expect(email.to).toBe(USER.email);
    expect(email.subject).toBe('Reset your Bandwagon password');
    const match = /\/reset-password\?token=([0-9a-f]{64})/.exec(email.text ?? '');
    expect(match).not.toBeNull();
    const raw = match![1];
    expect(raw).not.toBe(created.tokenHash); // raw token is never stored
    expect(sha256(raw)).toBe(created.tokenHash);
    expect(email.html).toContain(`/reset-password?token=${raw}`);
  });

  it('502 when the email fails to send', async () => {
    pm.user.findUnique.mockResolvedValue(USER);
    sendEmailMock.mockResolvedValue({ status: 'failed', permanent: true, detail: 'Resend 403' });
    const res = await request(app).post('/auth/forgot-password').send({ email: USER.email });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Could not send the reset email. Try again later');
  });

  it('200 when sending is skipped (no API key in dev/test)', async () => {
    pm.user.findUnique.mockResolvedValue(USER);
    sendEmailMock.mockResolvedValue({ status: 'skipped' });
    const res = await request(app).post('/auth/forgot-password').send({ email: USER.email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /auth/reset-password', () => {
  const RAW = 'a'.repeat(64);
  const ROW = { id: 'prt-1', userId: USER.id, user: USER };

  it('sets the new password, burns the token, and returns a login response', async () => {
    pm.passwordResetToken.findFirst.mockResolvedValue(ROW);
    const res = await request(app).post('/auth/reset-password').send({ token: RAW, password: 'newpass456!' });
    expect(res.status).toBe(200);

    expect(pm.passwordResetToken.findFirst).toHaveBeenCalledWith({
      where: { tokenHash: sha256(RAW), usedAt: null, expiresAt: { gt: expect.any(Date) } },
      include: { user: true },
    });

    const updatedHash = pm.user.update.mock.calls[0][0].data.passwordHash;
    expect(await bcrypt.compare('newpass456!', updatedHash)).toBe(true);
    expect(pm.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: ROW.id },
      data: { usedAt: expect.any(Date) },
    });
    expect(pm.$transaction).toHaveBeenCalledTimes(1);

    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.user).toEqual({ id: USER.id, email: USER.email, username: USER.username, avatarUrl: null });
  });

  it('400 for an unknown, expired, or already-used token', async () => {
    pm.passwordResetToken.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/auth/reset-password').send({ token: RAW, password: 'newpass456!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired reset link');
    expect(pm.user.update).not.toHaveBeenCalled();
  });

  it('400 for a too-short password without touching the DB', async () => {
    const res = await request(app).post('/auth/reset-password').send({ token: RAW, password: 'sh0rt!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 8 characters');
    expect(pm.passwordResetToken.findFirst).not.toHaveBeenCalled();
  });

  it('400 when the new password misses a number or special character', async () => {
    const noNumber = await request(app).post('/auth/reset-password').send({ token: RAW, password: 'longenough!' });
    expect(noNumber.status).toBe(400);
    expect(noNumber.body.error).toBe('Password must include at least one number');

    const noSpecial = await request(app).post('/auth/reset-password').send({ token: RAW, password: 'longenough1' });
    expect(noSpecial.status).toBe(400);
    expect(noSpecial.body.error).toBe('Password must include at least one special character');
    expect(pm.passwordResetToken.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /auth/signup password policy', () => {
  it('rejects non-compliant passwords with specific messages', async () => {
    for (const [password, message] of [
      ['sh0rt!', 'Password must be at least 8 characters'],
      ['longenough!', 'Password must include at least one number'],
      ['longenough1', 'Password must include at least one special character'],
    ] as const) {
      const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
    }
    expect(pm.user.create).not.toHaveBeenCalled();
  });

  it('accepts a compliant password', async () => {
    pm.user.findUnique.mockResolvedValue(null);
    pm.user.create.mockResolvedValue({ id: 'u1', email: 'new@example.com', username: null, avatarUrl: null });
    const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'longenough1!' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});
