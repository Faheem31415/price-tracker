import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/export — CSV of every scrape attempt ever recorded
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `select store_product_id, product_name, option_label, scraped_at, price, stock, outcome
       from scrape_attempts
       order by scraped_at desc`
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="scrape_history.csv"');

    const header = ['store_product_id', 'product_name', 'option_label', 'timestamp_utc', 'price', 'stock', 'outcome'];
    res.write(header.join(',') + '\n');

    for (const row of result.rows) {
      const line = [
        csvEscape(row.store_product_id),
        csvEscape(row.product_name),
        csvEscape(row.option_label),
        csvEscape(new Date(row.scraped_at).toISOString()),
        row.price === null ? '' : csvEscape(row.price),
        row.stock === null ? '' : csvEscape(row.stock),
        csvEscape(row.outcome),
      ];
      res.write(line.join(',') + '\n');
    }

    res.end();
  } catch (err) {
    console.error('[export] error', err);
    res.status(500).json({ error: 'Failed to export CSV', detail: err.message });
  }
});

export default router;
