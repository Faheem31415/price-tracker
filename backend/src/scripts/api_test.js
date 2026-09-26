/**
 * Integration test — tests all API routes against a real DB.
 * Run from backend dir: node src/scripts/api_test.js
 */
import { createServer } from 'http';
import { query, pool } from '../db.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Import routers
import searchRouter from '../routes/search.js';
import productsRouter from '../routes/products.js';
import exportRouter from '../routes/export.js';
import scrapeRouter from '../routes/scrape.js';

const PORT = 4001; // use different port to avoid conflict

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/search', searchRouter);
app.use('/api/products', productsRouter);
app.use('/api/export', exportRouter);
app.use('/api/scrape', scrapeRouter);

const server = createServer(app);

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-scrape-secret': process.env.SCRAPE_SECRET || 'dev-secret-do-not-use-in-prod' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✅ ${message}`);
}

async function runTests() {
  // Clean DB state
  await query('delete from scrape_attempts');
  await query('delete from tracked_products');
  console.log('DB cleaned\n');

  // ---- 1. POST /api/products ---
  console.log('--- POST /api/products ---');
  const tracked = await req('POST', '/api/products', {
    store_product_id: '2667',
    product_name: 'Halvard Rowing Machine Duo',
    option_label: 'Regular',
    option_code: 'o2',
    product_url: 'https://demo.inelabteamdev.com/item/2667',
  });
  assert(tracked.status === 201, `status=201 (got ${tracked.status})`);
  assert(tracked.data.id, 'has id');
  assert(tracked.data.store_product_id === '2667', 'store_product_id matches');
  const productId = tracked.data.id;

  // ---- 2. GET /api/products ---
  console.log('\n--- GET /api/products ---');
  const list = await req('GET', '/api/products');
  assert(list.status === 200, `status=200 (got ${list.status})`);
  assert(Array.isArray(list.data.results), 'results is array');
  assert(list.data.results.length === 1, 'one tracked product');

  // ---- 3. GET /api/products/:id/history (empty) ---
  console.log('\n--- GET /api/products/:id/history (empty) ---');
  const histEmpty = await req('GET', `/api/products/${productId}/history`);
  assert(histEmpty.status === 200, `status=200 (got ${histEmpty.status})`);
  assert(Array.isArray(histEmpty.data.history), 'history is array');
  assert(histEmpty.data.history.length === 0, 'no history yet');

  // ---- 4. GET /api/products/:id/log (empty) ---
  console.log('\n--- GET /api/products/:id/log (empty) ---');
  const logEmpty = await req('GET', `/api/products/${productId}/log`);
  assert(logEmpty.status === 200, `status=200 (got ${logEmpty.status})`);
  assert(Array.isArray(logEmpty.data.log), 'log is array');

  // ---- 5. GET /api/export (empty but valid CSV) ---
  console.log('\n--- GET /api/export (empty) ---');
  const exportEmpty = await req('GET', '/api/export');
  assert(exportEmpty.status === 200, `status=200 (got ${exportEmpty.status})`);
  const csvHeader = exportEmpty.data.split('\n')[0].trim();
  assert(
    csvHeader === 'store_product_id,product_name,option_label,timestamp_utc,price,stock,outcome',
    `CSV header correct (got: "${csvHeader}")`
  );

  // ---- 6. Insert fake scrape attempts (success + failed) ---
  console.log('\n--- Inserting fake scrape attempts ---');
  await query(
    `insert into scrape_attempts (store_product_id, product_name, option_label, price, stock, outcome)
     values ($1,$2,$3,$4,$5,$6)`,
    ['2667', 'Halvard Rowing Machine Duo', 'Regular', 1299.00, true, 'success']
  );
  await query(
    `insert into scrape_attempts (store_product_id, product_name, option_label, price, stock, outcome)
     values ($1,$2,$3,$4,$5,$6)`,
    ['2667', 'Halvard Rowing Machine Duo', 'Regular', null, null, 'failed']
  );
  console.log('  ✅ 2 rows inserted (1 success, 1 failed)');

  // ---- 7. GET /api/products/:id/history (has data) ---
  console.log('\n--- GET /api/products/:id/history (with data) ---');
  const hist = await req('GET', `/api/products/${productId}/history`);
  assert(hist.status === 200, `status=200 (got ${hist.status})`);
  // History returns ALL rows (success + failed) — the frontend chart filters price !== null client-side
  assert(hist.data.history.length === 2, `2 rows in history (success + failed) (got ${hist.data.history.length})`);
  const hRow = hist.data.history[0];
  assert(Number(hRow.price) === 1299, `price=1299 (got ${hRow.price})`);
  assert(hRow.stock === true, `stock=true (got ${hRow.stock})`);
  assert(hRow.outcome === 'success', `outcome=success (got ${hRow.outcome})`);
  assert(hRow.scraped_at, 'has scraped_at timestamp');

  // ---- 8. GET /api/products/:id/log (has data) ---
  console.log('\n--- GET /api/products/:id/log (with data) ---');
  const log = await req('GET', `/api/products/${productId}/log`);
  assert(log.status === 200, `status=200 (got ${log.status})`);
  assert(log.data.log.length === 2, `2 rows in log (got ${log.data.log.length})`);
  const failedRow = log.data.log.find((r) => r.outcome === 'failed');
  assert(failedRow, 'failed row exists in log');
  assert(failedRow.price === null, 'failed row has null price');
  assert(failedRow.stock === null, 'failed row has null stock');

  // ---- 9. GET /api/export with data ---
  console.log('\n--- GET /api/export (with data) ---');
  const exportWithData = await req('GET', '/api/export');
  assert(exportWithData.status === 200, `status=200 (got ${exportWithData.status})`);
  const csvLines = exportWithData.data.trim().split('\n');
  assert(csvLines.length === 3, `3 lines (header + 2 data rows), got ${csvLines.length}`);

  // Check header
  assert(
    csvLines[0].trim() === 'store_product_id,product_name,option_label,timestamp_utc,price,stock,outcome',
    'CSV header correct'
  );
  // Check that failed row has empty price and stock fields
  const failedCsvRow = csvLines.find((l) => l.includes(',failed'));
  assert(failedCsvRow, 'failed row in CSV');
  const fields = failedCsvRow.split(',');
  assert(fields[4] === '', `price empty for failed row (got "${fields[4]}")`);
  assert(fields[5] === '', `stock empty for failed row (got "${fields[5]}")`);
  // Check timestamps are ISO 8601
  const tsMatch = csvLines[1].match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert(tsMatch, 'timestamp is ISO 8601 format');

  // ---- 10. GET /api/search (real network call) ---
  console.log('\n--- GET /api/search?q=halvard ---');
  const search = await req('GET', '/api/search?q=halvard');
  assert(search.status === 200, `status=200 (got ${search.status})`);
  assert(Array.isArray(search.data.results), 'results is array');
  assert(search.data.results.length > 0, `results not empty (got ${search.data.results.length})`);
  assert(search.data.results.every((r) => r.name?.toLowerCase().includes('halvard')), 'all results match query');

  // ---- 11. POST /api/scrape/run without secret (should 401) ---
  console.log('\n--- POST /api/scrape/run auth check ---');
  const scrapeNoAuth = await fetch(`http://localhost:${PORT}/api/scrape/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert(scrapeNoAuth.status === 401, `401 without secret (got ${scrapeNoAuth.status})`);

  // ---- 12. Non-existent product ---
  console.log('\n--- GET /api/products/9999/history (not found) ---');
  const notFound = await req('GET', '/api/products/9999/history');
  assert(notFound.status === 404, `404 for missing product (got ${notFound.status})`);

  console.log('\n\n✅ ALL TESTS PASSED\n');
}

await new Promise((res, rej) => {
  server.listen(PORT, (err) => (err ? rej(err) : res()));
});
console.log(`Test server on :${PORT}\n`);

try {
  await runTests();
} catch (err) {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
  await pool.end();
}
