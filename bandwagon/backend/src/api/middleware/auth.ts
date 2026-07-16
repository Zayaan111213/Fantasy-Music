import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma';

export interface AuthRequest extends Request {
  userId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'bandwagon-dev-secret';

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let payload: { userId: string };
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Tokens live 30 days, so a signature check alone would keep serving
  // accounts that were deleted after the token was issued.
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.userId = payload.userId;
    next();
  } catch (err) {
    next(err);
  }
}
