CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name text NOT NULL,
    contact_email text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku text NOT NULL UNIQUE,
    name text NOT NULL,
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
