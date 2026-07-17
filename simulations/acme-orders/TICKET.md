# ACME-1287 · Duplicate orders (and double charges) when checkout is retried

**Priority:** High · **Reporter:** Dana Okafor (Support) · **Affects:** production · **Opened:** 2026-07-10

## Summary

Two customers reported receiving **duplicate orders and duplicate PayFlow charges** for a single checkout. Both incidents happened on 2026-07-09, during the PayFlow latency incident (their status page reported elevated capture times, p99 > 4s, between 13:40 and 15:05 UTC).

We shipped idempotency keys for the checkout endpoint last quarter (ACME-1104), and support was told this class of problem was fixed. It is still happening.

## Incident 1 — Bluewater Supply Co

Customer submitted one checkout from the dashboard; two orders (and two charges) were created, both for $485.00. Inventory for the affected SKUs was also decremented twice.

Production API logs (filtered to the relevant requests):

```
2026-07-09T14:12:03.118Z info  request.start  request_id=req_a941d0 method=POST path=/api/orders idempotency_key=ck_7f3d9a12e64b
2026-07-09T14:12:07.542Z info  payflow.capture capture_id=cap_1de20c119a5b22f0 amount_cents=48500 reference=0d9c41c7-2f31-4c4e-9f04-6a52a4f2b3d1
2026-07-09T14:12:07.561Z info  order.created  request_id=req_a941d0 order_id=0d9c41c7-2f31-4c4e-9f04-6a52a4f2b3d1 customer_id=6b1f6a0e-... total_cents=48500 idempotency_key=ck_7f3d9a12e64b
2026-07-09T14:12:07.564Z info  request.finish request_id=req_a941d0 method=POST path=/api/orders status=201 duration_ms=4446

2026-07-09T14:12:06.203Z info  request.start  request_id=req_5c77e2 method=POST path=/api/orders idempotency_key=ck_7f3d9a12e64b
2026-07-09T14:12:10.688Z info  payflow.capture capture_id=cap_88a3f00c4b719ce4 amount_cents=48500 reference=57aa9f2e-8c11-4f6e-b7a3-91d24c0f88ea
2026-07-09T14:12:10.704Z info  order.created  request_id=req_5c77e2 order_id=57aa9f2e-8c11-4f6e-b7a3-91d24c0f88ea customer_id=6b1f6a0e-... total_cents=48500 idempotency_key=ck_7f3d9a12e64b
2026-07-09T14:12:10.707Z info  request.finish request_id=req_5c77e2 method=POST path=/api/orders status=201 duration_ms=4504
```

Note: both requests carry the **same idempotency key** and both returned `201`.

## Incident 2 — Northfield Retail Group

Same pattern via their purchasing integration (server-to-server, not the dashboard). Their integration retries `POST /api/orders` on a 3-second client timeout, reusing the idempotency key, which is exactly what our API docs tell integrators to do. Two orders were created, roughly 3 seconds apart, same key. (Log excerpt available on request — identical shape to incident 1.)

## What support has already checked

- The duplicates are real distinct order rows, not a dashboard rendering issue.
- Keys were **not** reused across different checkouts; each duplicate pair shares one key.
- We could not reproduce it locally with a simple "submit, then submit again" test — the second attempt correctly returns the original order.

## Ask

Investigate the root cause, fix it, and add regression coverage so this cannot quietly come back. Finance is manually refunding duplicates in the meantime.
