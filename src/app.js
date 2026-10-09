import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config/index.js';
import sessionRoutes from './routes/sessionRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import knowledgeRoutes from './routes/knowledgeRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { db } from './config/database.js';
import trialRoutes from './routes/trialRoutes.js';
import liveAvatarRoutes from './routes/liveAvatarRoutes.js';

export const app = express();

/*
 * ngrok is a proxy. This allows req.ip to use the
 * original visitor IP from X-Forwarded-For.
 */
app.set('trust proxy', 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.join(__dirname, '../public');


app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = [
  config.FRONTEND_ORIGIN,
  config.APP_BASE_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Direct browser visits may have no Origin header.
      if (!origin) {
        return callback(null, true);
      }

      const isAllowedOrigin =
        allowedOrigins.includes(origin);

      // Temporary rule for ngrok development URLs.
      const isNgrokDevelopmentOrigin =
        /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i.test(
          origin
        );

      if (
        isAllowedOrigin ||
        isNgrokDevelopmentOrigin
      ) {
        return callback(null, true);
      }

      return callback(
        new Error('Origin not allowed by CORS')
      );
    },

    credentials: true
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.COOKIE_SECRET));

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Serve files such as test-chat.html and test-chat.js.
app.use(express.static(publicDirectory));

// Open the chatbot when visiting http://localhost:3000/
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDirectory, 'html', 'test-chat.html'));
});

// ADMIN KNOWLEDGE DASHBOARD
// =========================================================
//
// http://localhost:3000/admin/knowledge
//
app.get('/admin/knowledge',
  (_req, res) => { res.sendFile(path.join( publicDirectory, 'html', 'admin-knowledge.html'));}
);
app.use('/api/chat/session', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/trial', trialRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/liveavatar', liveAvatarRoutes);

app.get('/health', async (_req, res, next) => {
  try {
    await db.query('SELECT 1');

    res.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});


app.use(errorHandler);