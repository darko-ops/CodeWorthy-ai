# ACME-1490 · Regressions after the order-export merge

**Priority:** P2 · **Reporter:** Ops (on-call) · **Affects:** production · **Opened:** 2026-07-20

## Summary

Since the order-export feature shipped on Thursday (the `feature/order-export`
merge), two things have gone wrong in production, and both trace back to that
release. We need someone to **audit that merge**, find what regressed, repair it
**without losing the export feature**, and add coverage so a merge can't silently
do this again.

## Symptom 1 — the duplicate-charge monitor flatlined

Our duplicate-charge monitor (built after ACME-1287) keys on `order.checkout`
log events — specifically the `replayed=true` rate. Since Thursday it reports
**zero** `order.checkout` events, which the dashboard renders as "no duplicate
charges." We know that's not true; other signals show checkouts are happening
normally. The monitor isn't erroring — the events it depends on simply stopped
arriving. A dead signal that reads as "all clear" is worse than an alert storm.

```
# duplicate-charge monitor, events/min keyed on event=order.checkout
2026-07-17T09:00Z  order.checkout  count=418
2026-07-17T09:01Z  order.checkout  count=402
...
2026-07-18T14:31Z  order.checkout  count=0     <-- export release deployed 14:29Z
2026-07-18T14:32Z  order.checkout  count=0
2026-07-19T00:00Z  order.checkout  count=0
(flat zero since)
```

## Symptom 2 — a partner read another company's orders

A partner's integration test hit `GET /api/orders` (no `customerId` filter) and
got **another company's orders back** in the response. That endpoint is supposed
to require an ops credential for the cross-customer listing; right now it's
returning all customers' recent orders to anyone who calls it. This is a
cross-tenant data exposure and started after the same merge.

## What ops has already checked

- Both symptoms began immediately after the `feature/order-export` deploy on
  Thursday; nothing else shipped in that window.
- The export feature itself works — finance is successfully pulling CSVs.
- The visible test suite is green, and was green through the merge. That's part
  of why this shipped.

## Ask

Audit the export merge. Find everything it regressed — not just the two symptoms
above — repair it without losing the export feature, add tests that would have
caught the loss, and be ready to explain **why green CI didn't catch a deleted
authorization check**. Whatever the merge changed relative to `main`, assume it
was unintentional until proven otherwise.
