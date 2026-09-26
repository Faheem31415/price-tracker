import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function PriceChart({ history }) {
  const data = history
    .filter((h) => h.price !== null)
    .map((h) => ({
      time: new Date(h.scraped_at).toLocaleString(),
      price: Number(h.price),
      stock: h.stock ? 1 : 0,
    }));

  if (data.length === 0) {
    return <p className="muted">No successful price readings yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" hide />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="price" name="Price (₹)" stroke="#2563eb" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
