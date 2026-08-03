import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Several suites share one Postgres database and TRUNCATE between tests, so
    // files must not run concurrently.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
