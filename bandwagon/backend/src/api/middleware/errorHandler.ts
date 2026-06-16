import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.flatten() });
    return;
  }
  if (err instanceof Error) {
    console.error(err);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
