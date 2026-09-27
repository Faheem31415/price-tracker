import { Router } from 'express';
import { query } from '../db.js';
import { scrapeProduct } from '../scraper/scrapeProduct.js';

const router = Router();

function requireScrapeSecret(req, res, next) {
  const provided = req.header('x-scrape-secret') || req.query.secret;
  if (!process.env.SCRAPE_SECRET) {
    console.error('[scrape] SCRAPE_SECRET is not configured on the server');
    return res.status(500).json({ error: 'Server misconfigured: SCRAPE_SECRET not set' });
  }
  if (provided !== process.env.SCRAPE_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing x-scrape-secret header' });
  }
  next();
}

/**
 * POST /api/scrape/run
 *
 * Meant to be called by an external cron (cron-job.org) every 2 hours.
 * Runs every tracked product SEQUENTIALLY (Playwright + a free-tier host
 * means we should not fan out many concurrent browser instances). Each
 * product's failure is isolated — one bad scrape never aborts the batch,
 * and exactly one scrape_attempts row is written per product per run,
 * success or failure.
 */
let isScraping = false;

async function executeScrapeRun() {
  const startedAt = Date.now();
  const trackedResult = await query('select * from tracked_products');
  const tracked = trackedResult.rows;

  const runResults = [];

  for (const product of tracked) {
    try {
      console.log(`[scrape/run] scraping store_product_id=${product.store_product_id} option="${product.option_label}"`);
      const { price, stock, outcome } = await scrapeProduct(product.store_product_id, product.option_label);

      await query(
        `insert into scrape_attempts (store_product_id, product_name, option_label, price, stock, outcome)
         values ($1, $2, $3, $4, $5, $6)`,
        [product.store_product_id, product.product_name, product.option_label, price, stock, outcome]
      );

      runResults.push({ id: product.id, product_name: product.product_name, outcome });
    } catch (err) {
      console.error(`[scrape/run] unexpected error for product id=${product.id}`, err);
      await query(
        `insert into scrape_attempts (store_product_id, product_name, option_label, price, stock, outcome)
         values ($1, $2, $3, null, null, 'failed')`,
        [product.store_product_id, product.product_name, product.option_label]
      ).catch((insertErr) => console.error('[scrape/run] failed to log failure row', insertErr));

      runResults.push({ id: product.id, product_name: product.product_name, outcome: 'failed', error: err.message });
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[scrape/run] completed ${tracked.length} product(s) in ${durationMs}ms`);
  return { scraped: tracked.length, durationMs, results: runResults };
}

/**
 * POST or GET /api/scrape/run
 *
 * Called by external cron (cron-job.org) or manual triggers.
 * By default, returns immediately (HTTP 200) with a minimal plain-text response
 * and Connection: close so free cron services with strict buffer limits (4KB)
 * and 30-second timeouts never fail, while the scrape continues in the background.
 * Pass ?sync=true to block and wait for full results (useful for tests and Postman).
 */
const handleScrapeRun = async (req, res) => {
  if (isScraping) {
    res.set('Connection', 'close');
    return res.status(200).type('text/plain').send('IN_PROGRESS');
  }

  const isSync = req.query.sync === 'true';

  if (!isSync) {
    // Send minimal plain-text response and close socket immediately to prevent
    // cron-job.org 4KB buffer overflow and 30s timeout issues
    res.set('Connection', 'close');
    res.status(200).type('text/plain').send('OK');

    isScraping = true;
    executeScrapeRun()
      .catch((err) => console.error('[scrape/run] background fatal error', err))
      .finally(() => {
        isScraping = false;
      });
    return;
  }

  // Synchronous execution (?sync=true)
  isScraping = true;
  try {
    const result = await executeScrapeRun();
    res.json(result);
  } catch (err) {
    console.error('[scrape/run] fatal error', err);
    res.status(500).json({ error: 'Scrape run failed', detail: err.message });
  } finally {
    isScraping = false;
  }
};

router.post('/run', requireScrapeSecret, handleScrapeRun);
router.get('/run', requireScrapeSecret, handleScrapeRun);

export default router;
