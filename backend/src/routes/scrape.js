import { Router } from 'express';
import { query } from '../db.js';
import { scrapeProduct } from '../scraper/scrapeProduct.js';

const router = Router();

function requireScrapeSecret(req, res, next) {
  const provided = req.header('x-scrape-secret');
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
router.post('/run', requireScrapeSecret, async (req, res) => {
  const startedAt = Date.now();

  try {
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
        // Should be rare — scrapeProduct() itself is designed not to throw —
        // but if something unexpected happens, log a failed row rather than
        // letting it silently vanish from the log.
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
    res.json({ scraped: tracked.length, durationMs, results: runResults });
  } catch (err) {
    console.error('[scrape/run] fatal error', err);
    res.status(500).json({ error: 'Scrape run failed', detail: err.message });
  }
});

export default router;
