import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// POST /api/products — track a new product+option
router.post('/', async (req, res) => {
  const { store_product_id, product_name, option_label, option_code, product_url } = req.body || {};

  if (!store_product_id || !product_name || !option_label || !option_code || !product_url) {
    return res.status(400).json({
      error: 'Missing required field(s)',
      required: ['store_product_id', 'product_name', 'option_label', 'option_code', 'product_url'],
    });
  }

  try {
    const result = await query(
      `insert into tracked_products (store_product_id, product_name, option_label, option_code, product_url)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [store_product_id, product_name, option_label, option_code, product_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[products] insert error', err);
    res.status(500).json({ error: 'Failed to track product', detail: err.message });
  }
});

// GET /api/products — list all tracked products
router.get('/', async (req, res) => {
  try {
    const result = await query('select * from tracked_products order by created_at desc');
    res.json({ results: result.rows });
  } catch (err) {
    console.error('[products] list error', err);
    res.status(500).json({ error: 'Failed to list tracked products', detail: err.message });
  }
});

// GET /api/products/:id/history — price/stock time series for charting
router.get('/:id/history', async (req, res) => {
  try {
    const productResult = await query('select * from tracked_products where id = $1', [req.params.id]);
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Tracked product not found' });

    const history = await query(
      `select scraped_at, price, stock, outcome
       from scrape_attempts
       where store_product_id = $1 and option_label = $2
       order by scraped_at asc`,
      [product.store_product_id, product.option_label]
    );

    res.json({ product, history: history.rows });
  } catch (err) {
    console.error('[products] history error', err);
    res.status(500).json({ error: 'Failed to load history', detail: err.message });
  }
});

// GET /api/products/:id/log — full scrape attempt log, newest first
router.get('/:id/log', async (req, res) => {
  try {
    const productResult = await query('select * from tracked_products where id = $1', [req.params.id]);
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Tracked product not found' });

    const log = await query(
      `select id, scraped_at, price, stock, outcome
       from scrape_attempts
       where store_product_id = $1 and option_label = $2
       order by scraped_at desc`,
      [product.store_product_id, product.option_label]
    );

    res.json({ product, log: log.rows });
  } catch (err) {
    console.error('[products] log error', err);
    res.status(500).json({ error: 'Failed to load scrape log', detail: err.message });
  }
});

export default router;
