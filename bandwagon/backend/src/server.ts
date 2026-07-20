import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { sentryEnabled } from './instrument';

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
import tradeRoutes from './api/routes/trades';
import notificationRoutes from './api/routes/notifications';
import chartRoutes from './api/routes/charts';
import { errorHandler, notFound, shouldReportToSentry } from './api/middleware/errorHandler';
import { registerDraftSocket, startDraftScheduler } from './sockets/draft';
import { startPipelineScheduler } from './jobs/scheduler';
import { startEmailDispatcher } from './email/dispatcher';

const app = express();
const httpServer = createServer(app);

const isProd = process.env.NODE_ENV === 'production';
const corsOrigin = process.env.FRONTEND_URL || (isProd ? true : 'http://localhost:5173');

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

fs.mkdirSync(path.join(__dirname, '../uploads/avatars'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '../uploads/team-logos'), { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/leagues', draftRoutes);
app.use('/api/leagues', tradeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/charts', chartRoutes);

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const testHelperRoutes = require('./api/routes/testHelperRoutes').default;
  app.use('/api/test', testHelperRoutes);
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

app.use(notFound);
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app, { shouldHandleError: shouldReportToSentry });
}
app.use(errorHandler);

registerDraftSocket(io);
startDraftScheduler(io);
startPipelineScheduler(); // no-op under NODE_ENV=test / PIPELINE_SCHEDULER_DISABLED
startEmailDispatcher(); // no-op under NODE_ENV=test / EMAIL_DISPATCH_DISABLED / missing RESEND_API_KEY

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`🎵 Bandwagoner backend running on http://localhost:${PORT}`);
});
