import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["node-pty"],
  copy: [{ from: "public", to: "dist/public" }],
});
