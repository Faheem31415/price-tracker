import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import searchRouter from './routes/search.js';
import productsRouter from './routes/products.js';
import exportRouter from './routes/export.js';
import scrapeRouter from './routes/scrape.js';

dotenv.config();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
  })
);
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/search', searchRouter);
app.use('/api/products', productsRouter);
app.use('/api/export', exportRouter);
app.use('/api/scrape', scrapeRouter);

app.use((err, req, res, next) => {
  console.error('[server] unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
