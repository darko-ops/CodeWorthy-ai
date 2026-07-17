import { Router } from "express";
import type { OrderService } from "../services/orderService";
import { badRequest, notFound } from "../lib/errors";

export function ordersRouter(orders: OrderService): Router {
  const router = Router();

  // POST /api/orders
  // Integrations may send an Idempotency-Key header so that retried checkout
  // requests don't create duplicate orders (ACME-1104).
  router.post("/", async (req, res, next) => {
    try {
      const { customerId, items } = req.body ?? {};
      if (typeof customerId !== "string" || customerId.length === 0) {
        throw badRequest("missing_customer", "customerId is required");
      }
      const result = await orders.createOrder({
        customerId,
        items,
        idempotencyKey: req.header("idempotency-key") ?? undefined,
        requestId: req.requestId,
      });
      res.status(result.replayed ? 200 : 201).json(result.order);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders?customerId=...
  router.get("/", async (req, res, next) => {
    try {
      const customerId =
        typeof req.query.customerId === "string" ? req.query.customerId : undefined;
      res.json(await orders.listOrders(customerId));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/:id
  router.get("/:id", async (req, res, next) => {
    try {
      const order = await orders.getOrder(req.params.id);
      if (!order) throw notFound("unknown_order", `no order with id ${req.params.id}`);
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
