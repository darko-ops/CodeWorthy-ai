import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/logger";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-request-id") ?? `req_${randomBytes(3).toString("hex")}`;
  req.requestId = id;
  res.setHeader("x-request-id", id);

  const startedAt = Date.now();
  log.info("request.start", {
    request_id: id,
    method: req.method,
    path: req.path,
    idempotency_key: req.header("idempotency-key"),
  });
  res.on("finish", () => {
    log.info("request.finish", {
      request_id: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
    });
  });
  next();
}
