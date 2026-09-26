import { Router } from 'express';

const router = Router();
const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';

/**
 * GET /api/search?q=partial+name
 *
 * The store's listings endpoint doesn't appear to support a server-side
 * text filter (only page/limit), so we page through it and filter by
 * partial, case-insensitive name match. For 960 products at 50/page
 * that's ~20 requests worst case — acceptable for an on-demand search,
 * but cache this in front of real usage if it becomes a bottleneck.
 */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (!q) {
    return res.json({ results: [] });
  }

  try {
    const matches = [];
    let page = 1;
    let totalPages = 1;
    const limit = 50;

    do {
      const url = `${STORE_BASE_URL}/api/v2/listings?page=${page}&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Store listings request failed: HTTP ${response.status}`);
      }
      const data = await response.json();
      totalPages = data.totalPages || 1;

      for (const item of data.results || []) {
        if (item.name?.toLowerCase().includes(q)) {
          matches.push(item);
        }
      }

      page += 1;
      // Cap how many pages we're willing to scan for one search so a very
      // short/common query can't force scanning all 960 products.
    } while (page <= totalPages && page <= 20 && matches.length < 50);

    res.json({ results: matches.slice(0, 50) });
  } catch (err) {
    console.error('[search] error', err);
    res.status(502).json({ error: 'Failed to search the store', detail: err.message });
  }
});

export default router;
