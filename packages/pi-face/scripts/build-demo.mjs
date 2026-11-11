import { build } from "esbuild";

await build({
  entryPoints: {
    app: "demo/app.ts",
    collective: "demo/collective.ts",
  },
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: "demo",
});
