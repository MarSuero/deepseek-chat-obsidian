import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2018",
  platform: "node",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
};

if (prod) {
  await esbuild.build(options);
  process.exit(0);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[deepseek-chat] watching src/main.ts...");
}
