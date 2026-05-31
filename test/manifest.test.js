"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildChromium,
  collectManifestFiles,
  createChromiumManifest,
} = require("../scripts/build-chromium.js");

const ROOT_DIR = path.resolve(__dirname, "..");
const ICON_SIZES = [16, 32, 48, 96, 128];
const MAX_CHROME_DESCRIPTION_LENGTH = 132;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, file), "utf8"));
}

function iconPaths(manifest) {
  return [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
}

function sortedIconSizes(manifest) {
  return Object.keys(manifest.icons)
    .map(Number)
    .sort((a, b) => a - b);
}

test("Firefox manifest keeps Gecko settings and background scripts", () => {
  const manifest = readJson("manifest.json");

  assert.deepEqual(manifest.background, { scripts: ["background.js"] });
  assert.ok(manifest.browser_specific_settings.gecko);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, [
    "none",
  ]);
});

test("Chromium manifest uses service worker and drops Firefox-only settings", () => {
  const firefoxManifest = readJson("manifest.json");
  const chromiumManifest = createChromiumManifest(firefoxManifest);

  assert.deepEqual(chromiumManifest.background, { service_worker: "background.js" });
  assert.equal(chromiumManifest.browser_specific_settings, undefined);
  assert.equal(chromiumManifest.data_collection_permissions, undefined);
  assert.ok(chromiumManifest.description.length <= MAX_CHROME_DESCRIPTION_LENGTH);
});

test("both manifests reference only PNG icons", () => {
  const firefoxManifest = readJson("manifest.json");
  const chromiumManifest = createChromiumManifest(firefoxManifest);

  for (const manifest of [firefoxManifest, chromiumManifest]) {
    assert.deepEqual(sortedIconSizes(manifest), ICON_SIZES);
    for (const iconPath of iconPaths(manifest)) {
      assert.match(iconPath, /^icons\/icon-\d+\.png$/);
    }
  }
});

test("Chromium build writes the generated manifest and referenced files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gloam-chromium-"));
  const outputDir = path.join(tempRoot, "chromium");

  try {
    const { manifest } = buildChromium({ outputDir });
    const generatedManifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"),
    );

    assert.deepEqual(generatedManifest, manifest);
    assert.ok(fs.existsSync(path.join(outputDir, "LICENSE")));

    for (const file of collectManifestFiles(generatedManifest)) {
      assert.ok(fs.existsSync(path.join(outputDir, file)), `missing generated file: ${file}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
