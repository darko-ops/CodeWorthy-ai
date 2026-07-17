// Thin API client for the dashboard.
//
// PayFlow can be slow, and a hung checkout was our #1 support complaint in
// 2025 (ACME-1067). So checkout aborts after CHECKOUT_TIMEOUT_MS and retries
// once, reusing the Idempotency-Key as the API docs describe.
const CHECKOUT_TIMEOUT_MS = 3000;

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: string;
  totalCents: number;
  createdAt: string;
  items: Array<{ sku: string; quantity: number; unitPriceCents: number }>;
}

export interface CustomerRow {
  id: string;
  company_name: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  stock: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export const listCustomers = () => getJson<CustomerRow[]>("/api/customers");
export const listProducts = () => getJson<ProductRow[]>("/api/products");
export const listOrders = () => getJson<Order[]>("/api/orders");

export async function submitCheckout(input: {
  customerId: string;
  items: OrderItemInput[];
}): Promise<Order> {
  const idempotencyKey = `ck_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const attempt = async (): Promise<Order> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `checkout failed: ${res.status}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt();
  } catch (err) {
    // Timeout or network blip: retry once with the same key.
    if (err instanceof DOMException && err.name === "AbortError") {
      return attempt();
    }
    throw err;
  }
}
