-- ACME-1287: durable idempotency keys for checkout.
-- The previous implementation cached keys in process memory, which loses them
-- across replicas, restarts, and concurrent in-flight requests. The unique
-- constraint here is what serializes concurrent retries of the same checkout.
-- Additive only: the previous release ignores this table.
CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
