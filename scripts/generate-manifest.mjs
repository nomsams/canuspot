import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = path.join(projectRoot, "assets");
const sourceDirectory = path.join(assetsDirectory, "unsorted");
const manifestPath = path.join(assetsDirectory, "manifest.json");
const overridesPath = path.join(assetsDirectory, "focus-overrides.json");
const supportedExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const checkOnly = process.argv.includes("--check");

function naturalCompare(left, right) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function clamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function getFocus(filename, overrides) {
  const override = overrides[filename] || {};
  return {
    x: clamp(override.x, 50),
    y: clamp(override.y, 38),
  };
}

function classify(filename) {
  const lowerName = filename.toLowerCase();
  if (lowerName.startsWith("lady")) {
    return { category: "woman", answer: "woman", idPrefix: "woman" };
  }
  if (lowerName.startsWith("ldb")) {
    return { category: "trans-woman", answer: "trans", idPrefix: "trans-woman" };
  }
  return null;
}

function createStableId(filename, classification, usedIds) {
  const stem = path.parse(filename).name;
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portrait";
  const baseId = `${classification.idPrefix}-${slug}`;
  if (!usedIds.has(baseId)) return baseId;
  const suffix = createHash("sha1").update(filename).digest("hex").slice(0, 7);
  return `${baseId}-${suffix}`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const existingManifest = await readJson(manifestPath, []);
const focusOverrides = await readJson(overridesPath, {});
const preservedEntries = existingManifest.filter((entry) => !entry.src?.startsWith("assets/unsorted/"));
const usedIds = new Set(preservedEntries.map((entry) => entry.id));
const filenames = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)
  .sort(naturalCompare);

const generatedEntries = [];
const ignoredFiles = [];

for (const filename of filenames) {
  const classification = classify(filename);
  if (!classification) {
    ignoredFiles.push(filename);
    continue;
  }

  const id = createStableId(filename, classification, usedIds);
  usedIds.add(id);
  generatedEntries.push({
    id,
    src: `assets/unsorted/${filename}`,
    title: `Portrait ${preservedEntries.length + generatedEntries.length + 1}`,
    alt: "Portrait photo",
    category: classification.category,
    focus: getFocus(filename, focusOverrides),
    labels: { woman_trans: classification.answer },
  });
}

const nextManifest = `${JSON.stringify([...preservedEntries, ...generatedEntries], null, 2)}\n`;
const currentManifest = await readFile(manifestPath, "utf8").catch(() => "");

if (checkOnly) {
  if (currentManifest !== nextManifest) {
    console.error("assets/manifest.json is out of date. Run: npm run assets");
    process.exitCode = 1;
  } else {
    console.log(`Manifest is current: ${generatedEntries.length} generated portraits.`);
  }
} else {
  await writeFile(manifestPath, nextManifest, "utf8");
  console.log(`Updated assets/manifest.json with ${generatedEntries.length} generated portraits.`);
}

if (ignoredFiles.length) {
  console.warn(`Ignored files without a lady/ldb prefix: ${ignoredFiles.join(", ")}`);
}
