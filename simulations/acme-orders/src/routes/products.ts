import { Router } from "express";
import * as queries from "../legacy/queries";
import { notFound } from "../lib/errors";

export function productsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      res.json(await queries.getProducts());
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const product = await queries.getProductById(req.params.id);
      if (!product) throw notFound("unknown_product", `no product with id ${req.params.id}`);
      res.json(product);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
