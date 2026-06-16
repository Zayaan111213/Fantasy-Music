import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { signToken, requireAuth, type AuthRequest } from '../middleware/auth';

const router = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1).max(30),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, displayName } = SignupSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const initials = displayName.split(' ').map((w) => w[0]).join('').toUpperCase();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=6366f1&color=fff&size=256`,
      },
    });

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl } });
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
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
