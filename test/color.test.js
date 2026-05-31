"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseColor,
  luminance,
  mapColor,
  remap,
  LIGHT_TEXT,
  FG_PROPS,
  ruleOverride,
} = require("../color.js");

// Minimal stand-in for a CSSStyleRule's read interface (no DOM needed).
function styleRule(selectorText, props) {
  const keys = Object.keys(props);
  return {
    selectorText,
    style: {
      length: keys.length,
      item: (i) => keys[i],
      getPropertyValue: (p) => props[p] ?? "",
    },
  };
}

test("parseColor handles hex, short hex, rgb and rgba", () => {
  assert.deepEqual(parseColor("#faf9f5"), { r: 250, g: 249, b: 245, a: 1 });
  assert.deepEqual(parseColor("#FFF"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#08070680"), { r: 8, g: 7, b: 6, a: 128 / 255 }); // 8-digit hex
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

test("luminance fallback lifts near-white surfaces so raised ones read as raised", () => {
  // #faf8f4 is the active-tab gradient top: near-white -> the highest dark step,
  // so the active tab sits clearly above the base bar instead of merging into it.
  assert.equal(mapColor("#faf8f4", false), "#4a4946");
  assert.equal(mapColor("#dbd9d4", false), "#3a3a37"); // mid-light: tab border/edge
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
  assert.equal(out, "linear-gradient(#4a4946 0%, #3a3a37 60%)");
  // Unknown colors pass through untouched.
  assert.equal(remap("1px solid #123456", false), "1px solid #123456");
});

test("luminance() ranks dark below light", () => {
  assert.ok(luminance({ r: 38, g: 38, b: 36 }) < luminance({ r: 245, g: 244, b: 238 }));
});

test("parseColor reads percentage alpha", () => {
  assert.deepEqual(parseColor("rgba(0, 0, 0, 50%)"), { r: 0, g: 0, b: 0, a: 0.5 });
});

test("luminance fallback: dark-neutral text lifts to light", () => {
  // #2a2a2a is not in the token table, so this exercises the fallback (not a token).
  assert.equal(mapColor("#2a2a2a", true), LIGHT_TEXT);
});

test("luminance fallback: a dim neutral surface maps to the lowest step", () => {
  assert.equal(mapColor("#888888", false), "#353431");
});

test("a token with a dark target reads light when used as text", () => {
  // #191915 is a button surface as background, but light text in a fg role.
  assert.equal(mapColor("#191915", false), "#3a3a37");
  assert.equal(mapColor("#191915", true), LIGHT_TEXT);
});

test("stroke is a foreground property (icon outlines stay light)", () => {
  assert.ok(FG_PROPS.has("stroke"));
  // a white stroke is text-like -> left light (no override emitted)
  assert.equal(ruleOverride(styleRule(".i", { stroke: "#ffffff" })), "");
  // the same white as a surface darkens
  assert.equal(
    ruleOverride(styleRule(".i", { "background-color": "#ffffff" })),
    ".i{background-color:#3a3a37 !important}",
  );
});

test("remap never rewrites a color-like id inside url(...)", () => {
  assert.equal(remap("url(#fff)", false), "url(#fff)");
  assert.equal(remap("#faf9f5 url(#fff) #faf9f5", false), "#262624 url(#fff) #262624");
});

test("ruleOverride wraps group rules with the correct at-rule", () => {
  const inner = styleRule(".s", { color: "rgba(15, 12, 8, 0.92)" });
  const innerOut = ".s{color:rgba(245, 244, 238, 0.95) !important}";

  // @media is distinguished by .media (even when .conditionText is also present).
  assert.equal(
    ruleOverride({ cssRules: [inner], media: { mediaText: "screen" }, conditionText: "screen" }),
    `@media screen{${innerOut}}`,
  );
  // @supports has .conditionText but no .media — must NOT be wrapped as @media.
  assert.equal(
    ruleOverride({ cssRules: [inner], conditionText: "(display: grid)" }),
    `@supports (display: grid){${innerOut}}`,
  );
  // @container is distinguished by .containerQuery, with an optional name.
  assert.equal(
    ruleOverride({ cssRules: [inner], containerQuery: "(min-width: 200px)" }),
    `@container (min-width: 200px){${innerOut}}`,
  );
  assert.equal(
    ruleOverride({
      cssRules: [inner],
      containerQuery: "(min-width: 200px)",
      containerName: "side",
    }),
    `@container side (min-width: 200px){${innerOut}}`,
  );
});

test("ruleOverride returns empty for unthemeable or unknown rules", () => {
  // style rule with no color-bearing declaration
  assert.equal(ruleOverride(styleRule(".x", { display: "grid" })), "");
  // group rule whose inner produces nothing
  assert.equal(
    ruleOverride({
      cssRules: [styleRule(".x", { display: "grid" })],
      media: { mediaText: "print" },
    }),
    "",
  );
  // unknown group (e.g. @keyframes): has cssRules but no media/condition/container
  assert.equal(
    ruleOverride({ cssRules: [styleRule(".s", { color: "rgba(15, 12, 8, 0.92)" })] }),
    "",
  );
});
