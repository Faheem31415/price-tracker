/**
 * Standalone headed-mode runner — for the required screen recording.
 *
 * Launches the real scraper with a visible browser window (headless=false)
 * and verbose step-by-step console logging, against one tracked product.
 *
 * Usage:
 *   HEADED=true node src/scripts/headed.js <itemId> "<optionLabel>"
 *   (or) npm run scrape:headed -- 2737 "Collector Bundle"
 *
 * To actually demonstrate slow/failing handling on camera, either:
 *  (a) pick a product/option combo you've seen fail during recon, or
 *  (b) temporarily lower PRICE_RESOLVE_TIMEOUT_MS in scrapeProduct.js so a
 *      slow real response trips a retry on camera, then revert it.
 */
process.env.HEADED = 'true';

import { scrapeProduct } from '../scraper/scrapeProduct.js';

const [, , itemIdArg, optionLabelArg] = process.argv;

if (!itemIdArg || !optionLabelArg) {
  console.error('Usage: node src/scripts/headed.js <itemId> "<optionLabel>"');
  process.exit(1);
}

console.log(`[headed] Starting visible scrape run for item=${itemIdArg} option="${optionLabelArg}"`);
console.log('[headed] A browser window should open now — this is the same code path used by the scheduled scraper.\n');

const result = await scrapeProduct(itemIdArg, optionLabelArg);

console.log('\n[headed] Final result:', result);
