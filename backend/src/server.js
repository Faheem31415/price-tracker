import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';

import searchRouter from './routes/search.js';
import productsRouter from './routes/products.js';
import exportRouter from './routes/export.js';
import scrapeRouter from './routes/scrape.js';

dotenv.config();

// Never let an unhandled crash take the whole process down mid-request —
// on Render that would make in-flight responses (including cron-job.org's
// scrape trigger) come back as a platform-level "Application error" page,
// which is large HTML and would independently trigger "output too large".
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException', err);
});

const app = express();
app.disable('x-powered-by');

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, cron-job.org, health checks)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.options('*', cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/search', searchRouter);
app.use('/api/products', productsRouter);
app.use('/api/export', exportRouter);
app.use('/api/scrape', scrapeRouter);

app.use((err, req, res, next) => {
  console.error('[server] unhandled error', err);
  if (res.headersSent) return next(err);
  // Keep this short and generic on purpose — no stack traces, no verbose
  // JSON — so no route can ever return an oversized error body.
  res.status(500).type('text/plain').send('ERROR');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});