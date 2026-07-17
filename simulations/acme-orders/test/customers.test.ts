import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ensureMigrated } from "./helpers/testDb";

describe("customers API", () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureMigrated();
  });

  it("creates a customer and returns the legacy row shape", async () => {
    const res = await request(app).post("/api/customers").send({
      companyName: "Crescent Hardware",
      contactEmail: `crescent-${Date.now()}@example.test`,
    });
    expect(res.status).toBe(201);
    // Legacy endpoints return snake_case columns straight from Postgres.
    expect(res.body.company_name).toBe("Crescent Hardware");
    expect(res.body.id).toBeTruthy();
  });

  it("rejects a customer without an email", async () => {
    const res = await request(app).post("/api/customers").send({ companyName: "No Email Inc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_customer");
  });

  it("lists customers", async () => {
    const res = await request(app).get("/api/customers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
