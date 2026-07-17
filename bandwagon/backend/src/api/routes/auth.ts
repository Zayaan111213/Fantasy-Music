import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { signToken, requireAuth, type AuthRequest } from '../middleware/auth';
import { uploadAvatar } from '../middleware/upload';
import { sendEmail } from '../../email/mailer';
import { renderEmail } from '../../email/templates';

const router = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// New-password policy (signup + reset). Login is deliberately not policed —
// accounts created under the old rules must keep working.
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character';
  return null;
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const UsernameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, 'Username must be 3-20 characters: letters, numbers, and underscores only');

function usernameTaken(username: string, excludeUserId: string) {
  return prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, NOT: { id: excludeUserId } },
  });
}

function userResponse(user: { id: string; email: string; username: string | null; avatarUrl: string | null }) {
  return { id: user.id, email: user.email, username: user.username, avatarUrl: user.avatarUrl };
}

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = SignupSchema.parse(req.body);

    const policyError = passwordPolicyError(password);
    if (policyError) { res.status(400).json({ error: policyError }); return; }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash } });

    const token = signToken(user.id);
    res.json({ token, user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user.id);
    res.json({ token, user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(userResponse(user));
  } catch (err) {
    next(err);
  }
});

router.get('/check-username', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const username = UsernameSchema.parse(req.query.username);
    const existing = await usernameTaken(username, req.userId!);
    res.json({ available: !existing });
  } catch (err) {
    next(err);
  }
});

// Step 2 of signup: choose a username (required) and optionally upload a profile picture.
router.post('/complete-onboarding', requireAuth, uploadAvatar, async (req: AuthRequest, res, next) => {
  try {
    const username = UsernameSchema.parse(req.body.username);

    const current = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!current) { res.status(404).json({ error: 'User not found' }); return; }
    if (current.username !== null) { res.status(400).json({ error: 'Onboarding already complete' }); return; }

    const taken = await usernameTaken(username, req.userId!);
    if (taken) { res.status(409).json({ error: 'Username already taken' }); return; }

    const avatarUrl = req.file
      ? `/uploads/avatars/${req.file.filename}`
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=e8b23a&color=2c1e12&size=256`;

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { username, avatarUrl },
    });

    res.json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

// Account settings: change username/email/avatar, any subset, always multipart (file optional).
router.put('/me', requireAuth, uploadAvatar, async (req: AuthRequest, res, next) => {
  try {
    const Schema = z.object({
      username: UsernameSchema.optional(),
      email: z.string().email().optional(),
    });
    const data = Schema.parse(req.body);

    const current = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!current) { res.status(404).json({ error: 'User not found' }); return; }

    if (data.username) {
      const taken = await usernameTaken(data.username, req.userId!);
      if (taken) { res.status(409).json({ error: 'Username already taken' }); return; }
    }
    if (data.email) {
      const taken = await prisma.user.findFirst({ where: { email: data.email, NOT: { id: req.userId! } } });
      if (taken) { res.status(409).json({ error: 'Email already in use' }); return; }
    }

    const updateData: { username?: string; email?: string; avatarUrl?: string } = {};
    if (data.username) updateData.username = data.username;
    if (data.email) updateData.email = data.email;
    if (req.file) updateData.avatarUrl = `/uploads/avatars/${req.file.filename}`;

    if (Object.keys(updateData).length === 0) {
      res.json({ user: userResponse(current) });
      return;
    }

    const user = await prisma.user.update({ where: { id: req.userId! }, data: updateData });

    if (req.file && current.avatarUrl?.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '../../../uploads', current.avatarUrl.slice('/uploads/'.length));
      fs.unlink(oldPath, (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Failed to delete old avatar:', err);
      });
    }

    res.json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // reset links expire after 1 hour

function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Exported for testHelperRoutes: e2e needs a raw token, and only the hash is stored.
export async function createPasswordResetToken(userId: string): Promise<string> {
  // Invalidate outstanding tokens so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashResetToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  return raw;
}

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = ForgotPasswordSchema.parse(req.body);

    // Deliberately reveals whether an account exists (explicit product decision).
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: 'No account found with that email' });
      return;
    }

    const raw = await createPasswordResetToken(user.id);
    const appUrl = process.env.FRONTEND_URL || 'https://bandwagoner.com';
    const resetUrl = `${appUrl}/reset-password?token=${raw}`;

    const { html, text } = renderEmail({
      username: user.username,
      message:
        'We received a request to reset your Bandwagoner password. Click the button below to choose a new one. This link expires in 1 hour and can be used once.',
      cta: { url: resetUrl, label: 'Reset Password' },
      footer:
        "You're receiving this because a password reset was requested for your Bandwagoner account. If this wasn't you, you can safely ignore this email. Your password won't change.",
    });
    const result = await sendEmail({ to: user.email, subject: 'Reset your Bandwagoner password', html, text });

    if (result.status === 'failed') {
      console.error(`[auth] password reset email to ${user.email} failed: ${result.detail}`);
      res.status(502).json({ error: 'Could not send the reset email. Try again later' });
      return;
    }
    if (result.status === 'skipped') {
      // No RESEND_API_KEY (dev/e2e) — surface the link in the server log instead.
      console.log(`[auth] password reset link for ${user.email}: ${resetUrl}`);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string(),
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = ResetPasswordSchema.parse(req.body);

    const policyError = passwordPolicyError(password);
    if (policyError) { res.status(400).json({ error: policyError }); return; }

    const row = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashResetToken(token), usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!row) {
      // One message for garbage/expired/already-used — don't leak which.
      res.status(400).json({ error: 'Invalid or expired reset link' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);

    // Same response shape as /login so the client can log the user straight in.
    res.json({ token: signToken(row.userId), user: userResponse(row.user) });
  } catch (err) {
    next(err);
  }
});

export default router;
