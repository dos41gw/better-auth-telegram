import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", client: "src/client.ts" },
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  clean: true,
  sourcemap: true,
  outExtensions: ({ format }) => ({
    js: format === "es" ? ".js" : ".cjs",
    dts: format === "es" ? ".d.ts" : ".d.cts",
  }),
  outputOptions: { exports: "named" },
  deps: { onlyBundle: false, neverBundle: [/^[^./]/] },
});
