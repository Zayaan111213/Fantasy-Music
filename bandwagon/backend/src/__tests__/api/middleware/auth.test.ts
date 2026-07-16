import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../../db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../../db/prisma';
import { signToken, requireAuth } from '../../../api/middleware/auth';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../../api/middleware/auth';

const pm = prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } };

const JWT_SECRET = process.env.JWT_SECRET || 'bandwagon-dev-secret';

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  pm.user.findUnique.mockResolvedValue({ deletedAt: null });
});

describe('signToken', () => {
  it('returns a JWT string', () => {
    const token = signToken('user-123');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes the userId in the payload', () => {
    const token = signToken('user-abc');
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    expect(payload.userId).toBe('user-abc');
  });

  it('creates tokens that expire in ~30 days', () => {
    const token = signToken('user-123');
    const payload = jwt.decode(token) as { exp: number; iat: number };
    const diffSeconds = payload.exp - payload.iat;
    expect(diffSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe('requireAuth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = { headers: {} } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header lacks Bearer prefix', async () => {
    const req = { headers: { authorization: 'Token abc123' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.userId and calls next() for a valid token', async () => {
    const token = signToken('user-456');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(req.userId).toBe('user-456');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid (tampered) token', async () => {
    const req = { headers: { authorization: 'Bearer not.a.valid.jwt' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const token = jwt.sign({ userId: 'user-789' }, 'wrong-secret', { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a valid token whose user no longer exists', async () => {
    pm.user.findUnique.mockResolvedValue(null);
    const token = signToken('user-gone');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a valid token whose account was soft-deleted', async () => {
    pm.user.findUnique.mockResolvedValue({ deletedAt: new Date() });
    const token = signToken('user-deleted');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
