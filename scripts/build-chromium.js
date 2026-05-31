"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ALWAYS_COPY_FILES = Object.freeze(["LICENSE"]);
const MANIFEST_FILE_PATTERN = /^[\w./-]+\.(?:css|html?|js|json|png|svg|wasm|woff2?)$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }

  return strings;
}

function collectManifestFiles(manifest) {
  return [
    ...new Set(collectStrings(manifest).filter((value) => MANIFEST_FILE_PATTERN.test(value))),
  ];
}

function createChromiumManifest(firefoxManifest) {
  const icons = clone(firefoxManifest.icons);

  return {
    manifest_version: firefoxManifest.manifest_version,
    name: firefoxManifest.name,
    version: firefoxManifest.version,
    description: firefoxManifest.description,
    author: firefoxManifest.author,
    homepage_url: firefoxManifest.homepage_url,
    icons,
    permissions: clone(firefoxManifest.permissions),
    action: {
      ...clone(firefoxManifest.action),
      default_icon: icons,
    },
    background: {
      service_worker: "background.js",
    },
    content_scripts: clone(firefoxManifest.content_scripts),
  };
}

function readManifest(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
}

function copyFile(rootDir, outputDir, file) {
  const source = path.join(rootDir, file);
  const target = path.join(outputDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function buildChromium({
  rootDir = path.resolve(__dirname, ".."),
  outputDir = path.join(rootDir, "dist", "chromium"),
} = {}) {
  const firefoxManifest = readManifest(rootDir);
  const chromiumManifest = createChromiumManifest(firefoxManifest);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const file of [...ALWAYS_COPY_FILES, ...collectManifestFiles(chromiumManifest)]) {
    copyFile(rootDir, outputDir, file);
  }

  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(chromiumManifest, null, 2)}\n`,
  );

  return { outputDir, manifest: chromiumManifest };
}

if (require.main === module) {
  const { outputDir } = buildChromium();
  console.log(`wrote Chromium extension source to ${path.relative(process.cwd(), outputDir)}`);
}

module.exports = {
  collectManifestFiles,
  buildChromium,
  createChromiumManifest,
};
