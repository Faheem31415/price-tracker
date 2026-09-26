import { useState } from 'react';
import { api } from '../api.js';

/**
 * NOTE: the store's search/listings API does not return each product's
 * option list (edition/finish/etc.) or an option "code" — those are only
 * visible on the product's own page, which is rendered client-side and
 * gated behind the handshake/price-load flow the scraper also has to
 * navigate. Rather than run a live Playwright call just to populate a
 * dropdown, this form asks the user to enter the option label (and an
 * option code/slug if the store's markup exposes one) exactly as shown on
 * the product page. Revisit this once you've inspected a few real item
 * pages — if option codes turn out to be simple/predictable (e.g. "o1",
 * "o2", "o3" matching button order) this can become a dropdown instead.
 */
export default function ProductCard({ product, onTracked }) {
  const [optionLabel, setOptionLabel] = useState('');
  const [optionCode, setOptionCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleTrack(e) {
    e.preventDefault();
    if (!optionLabel.trim()) {
      setError('Please enter the option label (e.g. Regular, Solo, 1-pack).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.trackProduct({
        store_product_id: String(product.id),
        product_name: product.name,
        option_label: optionLabel.trim(),
        option_code: optionCode.trim() || 'o1',
        product_url: `https://demo.inelabteamdev.com/item/${product.id}`,
      });
      setDone(true);
      onTracked?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="product-card">
      <div className="product-card-header">
        <span className="badge">{product.category}</span>
        <h3>{product.name}</h3>
        <p className="muted">{product.brand} · SKU {product.sku}</p>
      </div>

      {done ? (
        <p className="success-text">Tracking started.</p>
      ) : (
        <form onSubmit={handleTrack} className="track-form">
          <input
            type="text"
            placeholder="Option label (e.g. Collector Bundle)"
            value={optionLabel}
            onChange={(e) => setOptionLabel(e.target.value)}
          />
          <input
            type="text"
            placeholder="Option code (optional, e.g. o1)"
            value={optionCode}
            onChange={(e) => setOptionCode(e.target.value)}
          />
          <button type="submit" disabled={saving}>
            {saving ? 'Tracking…' : 'Track'}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      )}
    </div>
  );
}
