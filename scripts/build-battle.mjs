import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const checkOnly = process.argv.includes("--check");
const outputPath = new URL("../battle.js", import.meta.url);
const entryPoint = fileURLToPath(new URL("../battle-source.js", import.meta.url));
const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "eof",
  minify: true,
  write: false,
  banner: { js: "/* Spot Check Battle bundle. Third-party notices: THIRD_PARTY_NOTICES.md */" },
});

const next = `${result.outputFiles[0].text.trim()}\n`;
if (checkOnly) {
  let current = "";
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    // The message below explains how to create a missing bundle.
  }
  if (current !== next) {
    console.error("battle.js is stale. Run npm run battle.");
    process.exitCode = 1;
  } else {
    console.log("Battle bundle is current.");
  }
} else {
  await writeFile(outputPath, next, "utf8");
  console.log(`Built battle.js (${Buffer.byteLength(next).toLocaleString()} bytes).`);
}
