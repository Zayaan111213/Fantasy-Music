import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { signToken, requireAuth, type AuthRequest } from '../middleware/auth';
import { uploadAvatar } from '../middleware/upload';

const router = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

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
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=6366f1&color=fff&size=256`;

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

export default router;
