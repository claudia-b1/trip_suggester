import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    // Only pure logic is covered — nothing here touches the database or the
    // network, so the suite stays fast and needs no fixtures.
    include: ["src/**/*.test.ts"],
  },
});
