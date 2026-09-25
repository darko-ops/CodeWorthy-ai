import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Several suites share one Postgres database and TRUNCATE between tests, so
    // files must not run concurrently.
    fileParallelism: false,
    // A FIXTURE key, computed rather than written out: a base64 literal beside
    // the word "KEY" is exactly what this project's own SECRET_PATTERNS
    // hard-coded-credential rule looks for, and a constant Buffer is
    // unmistakably not a real secret.
    env: { STEWARD_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64") },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
