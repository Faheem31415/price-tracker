import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PriceChart from './PriceChart.jsx';
import ScrapeLogTable from './ScrapeLogTable.jsx';

function ProductPanel({ product }) {
  const [history, setHistory] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [historyRes, logRes] = await Promise.all([
          api.getHistory(product.id),
          api.getLog(product.id),
        ]);
        if (!cancelled) {
          setHistory(historyRes.history);
          setLog(logRes.log);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  return (
    <section className="product-panel">
      <header>
        <h3>{product.product_name}</h3>
        <p className="muted">
          Option: {product.option_label} · Store ID: {product.store_product_id}
        </p>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <>
          <PriceChart history={history} />
          <h4>Scrape log</h4>
          <ScrapeLogTable log={log} />
        </>
      )}
    </section>
  );
}

export default function Dashboard({ refreshKey }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { results } = await api.listProducts();
        if (!cancelled) setProducts(results);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section>
      <div className="dashboard-header">
        <h2>Tracked products</h2>
        <a href={api.exportUrl()} className="export-button" download>
          Export CSV
        </a>
      </div>

      {loading && <p className="muted">Loading tracked products…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && products.length === 0 && (
        <p className="muted">No products tracked yet. Search above and track one.</p>
      )}

      {products.map((p) => (
        <ProductPanel key={p.id} product={p} />
      ))}
    </section>
  );
}
