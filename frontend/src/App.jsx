import { useState } from 'react';
import SearchBar from './components/SearchBar.jsx';
import ProductCard from './components/ProductCard.jsx';
import Dashboard from './components/Dashboard.jsx';

export default function App() {
  const [results, setResults] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Product Price Tracker</h1>
        <p className="muted">Tracking listings from INE's mock storefront.</p>
      </header>

      <section>
        <h2>Search products</h2>
        <SearchBar onResults={setResults} />
        <div className="results-grid">
          {results.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onTracked={() => setRefreshKey((k) => k + 1)}
            />
          ))}
        </div>
      </section>

      <Dashboard refreshKey={refreshKey} />
    </div>
  );
}
