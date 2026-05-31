"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { collectManifestFiles } = require("./build-chromium.js");

const MAX_CHROME_DESCRIPTION_LENGTH = 132;

const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.join(rootDir, "dist", "chromium");
const manifestPath = path.join(sourceDir, "manifest.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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

function assertFileExists(relativePath) {
  assert.ok(
    fs.existsSync(path.join(sourceDir, relativePath)),
    `missing generated file: ${relativePath}`,
  );
}

function lintChromiumManifest() {
  const manifest = readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.ok(
    manifest.description.length <= MAX_CHROME_DESCRIPTION_LENGTH,
    `description must be ${MAX_CHROME_DESCRIPTION_LENGTH} characters or less`,
  );
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.equal(manifest.browser_specific_settings, undefined);
  assert.equal(manifest.data_collection_permissions, undefined);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.action.default_icon, manifest.icons);

  for (const reference of collectStrings(manifest)) {
    assert.doesNotMatch(reference, /\.svg$/);
  }

  assertFileExists("LICENSE");
  for (const file of collectManifestFiles(manifest)) assertFileExists(file);

  return manifest;
}

if (require.main === module) {
  lintChromiumManifest();
  console.log("Chromium manifest validation passed");
}

module.exports = {
  lintChromiumManifest,
};
