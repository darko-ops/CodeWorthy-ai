-- ACME-1032: store the PayFlow capture id on the order so finance can
-- reconcile charges without asking engineering to grep logs.
ALTER TABLE orders ADD COLUMN payment_capture_id text;
