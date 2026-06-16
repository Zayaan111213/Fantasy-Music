import 'dotenv/config';

// BigInt → string for JSON serialization
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

import authRoutes from './api/routes/auth';
import leagueRoutes from './api/routes/leagues';
import artistRoutes from './api/routes/artists';
import draftRoutes from './api/routes/draft';
import notificationRoutes from './api/routes/notifications';
import { errorHandler, notFound } from './api/middleware/errorHandler';
import { registerDraftSocket } from './sockets/draft';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

fs.mkdirSync(path.join(__dirname, '../uploads/avatars'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '../uploads/team-logos'), { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/leagues', draftRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(notFound);
app.use(errorHandler);

registerDraftSocket(io);

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`🎵 Bandwagon backend running on http://localhost:${PORT}`);
});
