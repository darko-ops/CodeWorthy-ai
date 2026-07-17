import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ensureMigrated } from "./helpers/testDb";

describe("GET /health", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it("reports ok when the database is reachable", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
