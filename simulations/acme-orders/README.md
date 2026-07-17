# Acme Orders

Order management API for Acme Wholesale. Handles customers, the product catalog, order placement, and payment capture through PayFlow. B2B customers order via the web dashboard (`web/`) or server-to-server through the public API.

> Working on the assessment? Start with [ASSESSMENT.md](ASSESSMENT.md) and the ticket in [TICKET.md](TICKET.md).

## Stack

- Node 20+ / TypeScript / Express
- Postgres 14+
- Vitest + Supertest
- React dashboard (Vite) in `web/`

## Getting started

```bash
npm install
docker compose up -d db      # Postgres 16 on localhost:5432 (user/pass/db: acme/acme/acme_orders)
npm run migrate
npm run seed
npm run dev                  # API on http://localhost:3000
```

No Docker? Point `DATABASE_URL` at any Postgres 14+ database (see `.env.example` — the app reads plain environment variables, there is no dotenv loader).

Dashboard (optional):

```bash
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :3000
```

## Tests

```bash
npm test          # requires the database from docker compose (or DATABASE_URL)
npm run typecheck
```

The test suite migrates the target database automatically and truncates order data between suites — don't point it at a database you care about.

## API overview

| Method | Path                        | Notes                                                        |
| ------ | --------------------------- | ------------------------------------------------------------ |
| POST   | `/api/orders`               | Creates an order and captures payment. Supports `Idempotency-Key` header (see below). |
| GET    | `/api/orders?customerId=`   | Recent orders, optionally for one customer                   |
| GET    | `/api/orders/:id`           | Single order with line items                                 |
| GET    | `/api/customers`            | Legacy endpoint — returns snake_case rows                    |
| POST   | `/api/customers`            |                                                              |
| GET    | `/api/customers/:id/orders` |                                                              |
| GET    | `/api/products`             | Legacy endpoint — returns snake_case rows                    |
| GET    | `/api/products/:id`         |                                                              |
| GET    | `/health`                   |                                                              |

### Idempotent checkout (ACME-1104)

Integrations that retry `POST /api/orders` (e.g. on a client timeout) should send an `Idempotency-Key` header and reuse it for retries of the same checkout. The API returns the previously created order (`200`) instead of creating a duplicate (`201`).

### Payments

`src/payments/payflow.ts` simulates our PayFlow client. `PAYMENT_LATENCY_MS` controls capture latency (sandbox default 50ms; production has seen multi-second captures during provider incidents).

## Repository notes

- `src/services/` is the current pattern for business logic. `src/legacy/queries.ts` predates it and is still used by the customer/product routes; the admin dashboard depends on its snake_case response shape, so coordinate before changing those endpoints.
- Migrations are plain SQL in `db/migrations/`, applied in filename order by `npm run migrate` (tracked in `schema_migrations`). Production runs migrations before the new app version deploys — write them to be backwards compatible with the previous release.
- Deploys run **two API replicas** behind the load balancer; in-process state is per-replica.
- Logging is the structured single-line format in `src/lib/logger.ts` (see ACME-871 before touching it).
