import express from "express";
import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { AppError } from "./lib/errors";
import { log } from "./lib/logger";
import { requestId } from "./middleware/requestId";
import { customersRouter } from "./routes/customers";
import { ordersRouter } from "./routes/orders";
import { productsRouter } from "./routes/products";
import { OrderService } from "./services/orderService";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);

  const orderService = new OrderService(pool);

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", reason: "database unreachable" });
    }
  });

  app.use("/api/orders", ordersRouter(orderService));
  app.use("/api/customers", customersRouter(orderService));
  app.use("/api/products", productsRouter());

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    log.error("request.error", {
      request_id: req.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
