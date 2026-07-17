CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers (id),
    status text NOT NULL DEFAULT 'pending',
    total_cents integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);

CREATE TABLE order_items (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_cents integer NOT NULL
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
