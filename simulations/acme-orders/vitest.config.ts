import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests share one Postgres database, so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
