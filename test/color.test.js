"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseColor, luminance, mapColor, remap } = require("../color.js");

test("parseColor handles hex, short hex, rgb and rgba", () => {
  assert.deepEqual(parseColor("#faf9f5"), { r: 250, g: 249, b: 245, a: 1 });
  assert.deepEqual(parseColor("#FFF"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("rgb(250, 249, 245)"), { r: 250, g: 249, b: 245, a: 1 });
  assert.deepEqual(parseColor("rgba(15, 12, 8, 0.64)"), { r: 15, g: 12, b: 8, a: 0.64 });
  assert.equal(parseColor("not-a-color"), null);
});

test("matching is serialization-independent (hex == rgb)", () => {
  // CSSOM serializes #faf9f5 as rgb(250, 249, 245); both must map alike.
  assert.equal(mapColor("#faf9f5", false), "#262624");
  assert.equal(mapColor("rgb(250, 249, 245)", false), "#262624");
});

test("role-aware: a light token is dark as background but stays light as text", () => {
  // The crux bug: #faf9f5 is both the app background AND a button label color.
  assert.equal(mapColor("#faf9f5", false), "#262624"); // background -> dark
  assert.equal(mapColor("#faf9f5", true), "#faf9f5"); // text -> unchanged (light)
  assert.equal(mapColor("#ffffff", true), "#ffffff"); // white text stays white
});

test("warm-ink text recolors to light, preserving the alpha hierarchy", () => {
  assert.equal(mapColor("rgba(15, 12, 8, 0.92)", true), "rgba(245, 244, 238, 0.95)");
  assert.equal(mapColor("rgba(15, 12, 8, 0.64)", true), "rgba(245, 244, 238, 0.66)");
});

test("the terracotta accent is left untouched", () => {
  assert.equal(mapColor("#d97757", false), "#d97757");
  assert.equal(mapColor("#d97757", true), "#d97757");
});

test("low-alpha warm-ink shadows are left dark (not lightened)", () => {
  // 0.25 / 0.15 are box-shadows, not text — they must stay dark on dark.
  assert.equal(mapColor("rgba(15, 12, 8, 0.25)", false), "rgba(15, 12, 8, 0.25)");
});

test("luminance fallback darkens unmapped light neutrals (active-tab bug)", () => {
  // #faf8f4 is in the active-tab gradient but not in the token table.
  assert.equal(mapColor("#faf8f4", false), "#353431");
  assert.equal(mapColor("#dbd9d4", false), "#3a3a37"); // tab border
});

test("semi-transparent white: keep faint highlights, soften heavy fills", () => {
  // Low alpha (inset highlight) is kept so buttons stay raised.
  assert.equal(mapColor("rgba(255, 255, 255, 0.08)", false), "rgba(255, 255, 255, 0.08)");
  // High alpha (tab hover) is softened to a light tint, not a grey block.
  const soft = mapColor("rgba(255, 255, 255, 0.5)", false);
  assert.match(soft, /^rgba\(245, 244, 238, /);
});

test("the orange accent-button glow becomes a clean dark shadow", () => {
  assert.equal(mapColor("rgba(180, 90, 30, 0.35)", false), "rgba(0, 0, 0, 0.33)");
});

test("remap rewrites every color in a gradient, leaving unknown ones", () => {
  const out = remap("linear-gradient(rgb(250, 248, 244) 0%, rgb(255, 255, 255) 60%)", false);
  assert.equal(out, "linear-gradient(#353431 0%, #3a3a37 60%)");
  // Unknown colors pass through untouched.
  assert.equal(remap("1px solid #123456", false), "1px solid #123456");
});

test("luminance() ranks dark below light", () => {
  assert.ok(luminance({ r: 38, g: 38, b: 36 }) < luminance({ r: 245, g: 244, b: 238 }));
});
