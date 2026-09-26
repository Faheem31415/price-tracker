/**
 * Recon script — runs the scraper against representative live products
 * to validate accuracy and performance.
 *
 * Usage:
 *   npm run recon
 */
import { scrapeProduct } from '../scraper/scrapeProduct.js';

const SAMPLES = [
  { itemId: 2667, name: 'Halvard Rowing Machine Duo', option: 'Regular' },
  { itemId: 2198, name: 'Solvane Cooler Box Edge', option: 'Solo' },
  { itemId: 2075, name: 'Tamarack Network Switch One', option: '1-pack' },
];

async function main() {
  console.log('='.repeat(65));
  console.log('  PRODUCT PRICE TRACKER — LIVE RECON VALIDATION SUITE');
  console.log('='.repeat(65));

  const results = [];

  for (const sample of SAMPLES) {
    console.log(`\nTesting ${sample.name} (id=${sample.itemId}, option="${sample.option}")...`);
    const t0 = Date.now();
    const res = await scrapeProduct(sample.itemId, sample.option);
    const duration = ((Date.now() - t0) / 1000).toFixed(2);

    results.push({
      id: sample.itemId,
      name: sample.name,
      option: sample.option,
      price: res.price,
      stock: res.stock,
      outcome: res.outcome,
      duration: `${duration}s`,
    });
  }

  console.log('\n' + '='.repeat(65));
  console.log('  RECON RESULTS SUMMARY');
  console.log('='.repeat(65));
  console.table(results);

  const passed = results.filter((r) => r.outcome === 'success' || r.outcome === 'retried');
  console.log(`\nPassed: ${passed.length}/${results.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);

  if (passed.length === results.length) {
    console.log('\n🎉 ALL RECON TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error('\n⚠️ Some recon tests did not succeed.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Recon runner error:', err);
  process.exit(1);
});
