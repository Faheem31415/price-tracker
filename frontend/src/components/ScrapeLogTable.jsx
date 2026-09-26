export default function ScrapeLogTable({ log }) {
  if (log.length === 0) {
    return <p className="muted">No scrape attempts recorded yet.</p>;
  }

  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>Timestamp (UTC)</th>
          <th>Price</th>
          <th>Stock</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody>
        {log.map((row) => (
          <tr key={row.id} className={row.outcome === 'failed' ? 'row-failed' : row.outcome === 'retried' ? 'row-retried' : ''}>
            <td>{new Date(row.scraped_at).toISOString()}</td>
            <td>{row.price === null ? '—' : `₹${Number(row.price).toLocaleString('en-IN')}`}</td>
            <td>{row.stock === null ? '—' : row.stock ? 'In stock' : 'Sold out'}</td>
            <td>
              <span className={`outcome-badge outcome-${row.outcome}`}>{row.outcome}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
