import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "cli/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "vitest.config.ts",
      ],
      thresholds: {
        functions: 100,
        lines: 85,
        statements: 85,
      },
    },
    include: [
      "tests/**/*.test.ts",
      "test/**/*.test.{ts,js}",
      "src/**/*.test.ts",
    ],
    testTimeout: 30000,
  },
});
