import { useEffect, useState } from "react";
import {
  listCustomers,
  listOrders,
  listProducts,
  submitCheckout,
  type CustomerRow,
  type Order,
  type ProductRow,
} from "./api";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function App() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    listOrders().then(setOrders).catch(() => setMessage("failed to load orders"));
  };

  useEffect(() => {
    listCustomers().then(setCustomers).catch(() => setMessage("failed to load customers"));
    listProducts().then(setProducts).catch(() => setMessage("failed to load products"));
    refresh();
  }, []);

  const checkout = async () => {
    if (!customerId || !productId) return;
    setBusy(true);
    setMessage(null);
    try {
      const order = await submitCheckout({ customerId, items: [{ productId, quantity }] });
      setMessage(`order ${order.id.slice(0, 8)}… placed (${dollars(order.totalCents)})`);
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "checkout failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Acme Orders</h1>

      <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0 }}>New order</h2>
        <label>
          Customer{" "}
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">choose…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Product{" "}
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">choose…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name} ({dollars(p.unit_price_cents)})
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Qty{" "}
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            style={{ width: "4rem" }}
          />
        </label>{" "}
        <button onClick={checkout} disabled={busy || !customerId || !productId}>
          {busy ? "Placing…" : "Place order"}
        </button>
        {message && <p>{message}</p>}
      </section>

      <h2>Recent orders</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Order</th>
            <th>Status</th>
            <th>Total</th>
            <th>Placed</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{o.id.slice(0, 8)}…</td>
              <td>{o.status}</td>
              <td>{dollars(o.totalCents)}</td>
              <td>{new Date(o.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
