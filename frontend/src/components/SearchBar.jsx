import { useState } from 'react';
import { api } from '../api.js';

export default function SearchBar({ onResults }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { results } = await api.search(q.trim());
      onResults(results);
    } catch (err) {
      setError(err.message);
      onResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="search-bar">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products by name…"
        aria-label="Search products"
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Searching…' : 'Search'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
