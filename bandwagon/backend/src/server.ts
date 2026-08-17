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
import moderationRoutes from './api/routes/moderation';
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
// Mounted at /api rather than a prefix: it owns /api/reports and /api/users/*.
// Registered last so it can never shadow a more specific router above.
app.use('/api', moderationRoutes);

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const testHelperRoutes = require('./api/routes/testHelperRoutes').default;
  app.use('/api/test', testHelperRoutes);
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Universal Links. iOS fetches this file to learn which URLs on this domain
// the app is allowed to open, which is what makes the emailed password-reset
// link (an https:// URL) open the app instead of Safari.
//
// This MUST stay above the SPA catch-all below. Without it the catch-all
// answers with index.html as text/html and Apple's CDN rejects the file
// outright, silently — universal links just never work and there's nothing in
// the app to debug.
//
// `components` is the important part. `applinks:bandwagoner.com` in app.json
// claims the WHOLE domain by default, so without narrowing it here, tapping
// any bandwagoner.com link on a phone with the app installed would open the
// app — including the Privacy Policy and Terms links that Account Settings
// deliberately opens in a browser. Only /reset-password is claimed.
//
// League invite links are deliberately NOT claimed: an invite opened while
// logged out targets a screen that doesn't exist in the logged-out navigator,
// so the code would be dropped. LeagueJoinScreen's manual code entry covers
// that case until the pending-invite handoff is built.
//
// The Team ID is not a secret; this file is public by design and the same
// value is embedded in every copy of the app. It must match `bundleIdentifier`
// in mobile/app.json.
const APPLE_APP_ID = '64YY39ABUD.com.bandwagoner.app';
app.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.type('application/json').json({
    applinks: {
      details: [
        {
          appIDs: [APPLE_APP_ID],
          components: [{ '/': '/reset-password', comment: 'password reset link from email' }],
        },
      ],
    },
  });
});

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
