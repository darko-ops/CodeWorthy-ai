import { Router } from "express";
import * as queries from "../legacy/queries";
import type { OrderService } from "../services/orderService";
import { badRequest, notFound } from "../lib/errors";

// NOTE: customer endpoints still use the legacy query helpers and return
// snake_case rows; the admin dashboard depends on that shape (see
// src/legacy/queries.ts before changing anything here).
export function customersRouter(orders: OrderService): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      res.json(await queries.getCustomers());
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const { companyName, contactEmail } = req.body ?? {};
      if (!companyName || !contactEmail) {
        throw badRequest("invalid_customer", "companyName and contactEmail are required");
      }
      res.status(201).json(await queries.insertCustomer({ companyName, contactEmail }));
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/orders", async (req, res, next) => {
    try {
      const customer = await queries.getCustomerById(req.params.id);
      if (!customer) throw notFound("unknown_customer", `no customer with id ${req.params.id}`);
      res.json(await orders.listOrders(customer.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
