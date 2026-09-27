import { Router } from 'express';
import { query } from '../db.js';
import { scrapeProduct } from '../scraper/scrapeProduct.js';

const router = Router();

function requireScrapeSecret(req, res, next) {
  // Everything in here is wrapped and kept to short text/plain responses —
  // this runs before handleScrapeRun, so if anything here ever throws or
  // returns something large, it would independently trigger cron-job.org's
  // "output too large" / timeout errors regardless of what handleScrapeRun does.
  try {
    const provided = req.header('x-scrape-secret') || req.query.secret;
    if (!process.env.SCRAPE_SECRET) {
      console.error('[scrape] SCRAPE_SECRET is not configured on the server');
      return res.status(500).type('text/plain').send('CONFIG_ERROR');
    }
    if (provided !== process.env.SCRAPE_SECRET) {
      return res.status(401).type('text/plain').send('UNAUTHORIZED');
    }
    next();
  } catch (err) {
    console.error('[scrape] auth middleware crashed', err);
    if (!res.headersSent) {
      res.status(500).type('text/plain').send('AUTH_ERROR');
    }
  }
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
 * Always returns immediately (HTTP 200) with a minimal plain-text response
 * and Connection: close so free cron services with strict buffer limits and
 * 30-second timeouts never fail, while the scrape continues in the background.
 *
 * IMPORTANT: this handler is intentionally synchronous (not `async`) and the
 * response is sent as the very first thing it does, before touching the
 * database or Playwright at all. That guarantees cron-job.org always gets a
 * few bytes back immediately, no matter what happens afterwards — a crash in
 * executeScrapeRun() can never turn into a large or slow HTTP response,
 * because by the time it runs the response has already been sent and closed.
 *
 * Full synchronous results are still available for manual testing via
 * ?sync=true&debugToken=<SCRAPE_SECRET> — deliberately gated behind a second
 * check so a plain cron GET/POST (no query string) can never accidentally
 * fall into the slow/large path.
 */
const handleScrapeRun = (req, res) => {
  const wantsSync = req.query.sync === 'true' && req.query.debugToken === process.env.SCRAPE_SECRET;

  if (!wantsSync) {
    // Fast path — this is what cron-job.org hits every 2 hours.
    try {
      res.set('Connection', 'close');
      res.set('Cache-Control', 'no-store');

      if (isScraping) {
        res.status(200).type('text/plain').send('IN_PROGRESS');
      } else {
        res.status(200).type('text/plain').send('OK');
        isScraping = true;
        executeScrapeRun()
          .catch((err) => console.error('[scrape/run] background fatal error', err))
          .finally(() => {
            isScraping = false;
          });
      }
    } catch (err) {
      // Even the act of sending the response failed — log it, but never let
      // this bubble up to Express's default error handler (which can return
      // a large HTML/stack-trace page).
      console.error('[scrape/run] failed to send fast-path response', err);
      if (!res.headersSent) {
        res.status(500).type('text/plain').send('ERROR');
      }
    }
    return;
  }

  // Debug-only synchronous path — never reached by the cron trigger itself.
  if (isScraping) {
    return res.status(200).type('text/plain').send('IN_PROGRESS');
  }
  isScraping = true;
  executeScrapeRun()
    .then((result) => res.status(200).json(result))
    .catch((err) => {
      console.error('[scrape/run] fatal error (sync debug path)', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Scrape run failed' });
      }
    })
    .finally(() => {
      isScraping = false;
    });
};

router.post('/run', requireScrapeSecret, handleScrapeRun);
router.get('/run', requireScrapeSecret, handleScrapeRun);

export default router;