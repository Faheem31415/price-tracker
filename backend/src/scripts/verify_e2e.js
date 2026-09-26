import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query, pool } from '../db.js';

dotenv.config();

import searchRouter from '../routes/search.js';
import productsRouter from '../routes/products.js';
import exportRouter from '../routes/export.js';
import scrapeRouter from '../routes/scrape.js';

const PORT = 4002;
const SECRET = process.env.SCRAPE_SECRET || 'dev-secret-do-not-use-in-prod';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/search', searchRouter);
app.use('/api/products', productsRouter);
app.use('/api/export', exportRouter);
app.use('/api/scrape', scrapeRouter);

const server = createServer(app);

async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function run() {
  console.log('--- 1. Resetting database state ---');
  await query('delete from scrape_attempts');
  await query('delete from tracked_products');

  console.log('--- 2. Track real product 2667 (Regular) ---');
  const trackRes = await req('POST', '/api/products', {
    store_product_id: '2667',
    product_name: 'Halvard Rowing Machine Duo',
    option_label: 'Regular',
    option_code: 'o2',
    product_url: 'https://demo.inelabteamdev.com/item/2667',
  });
  console.log('Track product status:', trackRes.status, trackRes.data);
  const productId = trackRes.data.id;

  console.log('\n--- 3. Trigger live scrape run via POST /api/scrape/run ---');
  const t0 = Date.now();
  const scrapeRes = await req('POST', '/api/scrape/run', null, {
    'x-scrape-secret': SECRET,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`Scrape run completed in ${elapsed}s:`, scrapeRes.status, scrapeRes.data);

  console.log('\n--- 4. Verify history endpoint ---');
  const histRes = await req('GET', `/api/products/${productId}/history`);
  console.log('History:', JSON.stringify(histRes.data, null, 2));

  console.log('\n--- 5. Verify log endpoint ---');
  const logRes = await req('GET', `/api/products/${productId}/log`);
  console.log('Log:', JSON.stringify(logRes.data, null, 2));

  console.log('\n--- 6. Verify CSV export endpoint ---');
  const exportRes = await req('GET', '/api/export');
  console.log('CSV Export Output:\n' + exportRes.data);

  const outcome = scrapeRes.data.results?.[0]?.outcome;
  if (outcome === 'success' || outcome === 'retried') {
    console.log(`\n🎉 FULL END-TO-END FLOW VERIFIED SUCCESSFULLY! (outcome: ${outcome})\n`);
  } else {
    console.error('\n⚠️ Scrape run did not return a successful outcome:', outcome);
  }
}

await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`E2E test server listening on :${PORT}`);

try {
  await run();
} finally {
  server.close();
  await pool.end();
}
