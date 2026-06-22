import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import multer from 'multer';
import { errorHandler, notFound } from '../../../api/middleware/errorHandler';
import type { Request, Response, NextFunction } from 'express';

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const req = {} as Request;
const next = vi.fn() as NextFunction;

describe('errorHandler', () => {
  it('returns 400 with validation details for ZodError', () => {
    const zodErr = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['name'], message: 'Expected string' },
    ]);
    const res = mockRes();
    errorHandler(zodErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation error' })
    );
  });

  it('returns 400 with the multer error message for MulterError', () => {
    const multerErr = new multer.MulterError('LIMIT_FILE_SIZE');
    const res = mockRes();
    errorHandler(multerErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: multerErr.message });
  });

  it('returns 500 for a generic Error', () => {
    const err = new Error('Something broke');
    const res = mockRes();
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Something broke' });
  });

  it('uses a custom status property on Error when present', () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    const res = mockRes();
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 for a non-Error thrown value', () => {
    const res = mockRes();
    errorHandler('string error', req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});

describe('notFound', () => {
  it('returns 404 with a not found message', () => {
    const res = mockRes();
    notFound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});
