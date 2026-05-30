"use strict";

/*
 * Gloam — dark theme engine for the Claude Design native panels.
 *
 * Pure color logic lives in color.js (loaded first via the manifest, also unit
 * tested). This file is the DOM glue: it reads the page's own stylesheet and
 * inline colors, remaps them by value, and writes the result into a single
 * injected <style> plus minimal inline overrides.
 *
 * The design preview lives in a cross-origin <iframe> (claudeusercontent.com),
 * whose stylesheets are not part of this document — so it is physically
 * impossible for this engine to touch it. The preview stays pixel-identical.
 *
 * Toggling: the page's own rules are never mutated. Overrides go into one
 * injected <style>; inline edits remember their originals. Disabling removes
 * the element, the gating attribute, and restores inline styles, leaving the
 * page byte-for-byte unchanged.
 */

/* global remap */
// `remap` is defined in color.js, which the manifest loads first into this same
// content-script scope (files in one content_scripts entry share one scope).

const ATTR = "data-gloam";
const api = typeof browser !== "undefined" ? browser : chrome;

// Foreground properties paint text/icons, so a light source color must STAY
// light on a dark theme (e.g. a button label colored #FAF9F5 — the same token
// as the app background, but here it's text). color.js handles the recolor;
// here we just flag which properties are foreground.
const FG_PROPS = new Set([
  "color",
  "-webkit-text-fill-color",
  "fill",
  "caret-color",
  "text-decoration-color",
]);

// Some surfaces (e.g. the top bar) get their color from an inline style, which
// stylesheet overrides can't reach. We rewrite those directly and remember the
// originals so disabling restores the page exactly.
const INLINE_PROPS = [
  "background-color",
  "background",
  "color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "box-shadow",
  "fill",
  "stroke",
  "outline-color",
];

let inlineTouched = []; // [{ el, prop, orig, prio }]

function applyInline() {
  for (const el of document.querySelectorAll("[style]")) {
    const st = el.style;
    for (const prop of INLINE_PROPS) {
      const val = st.getPropertyValue(prop);
      if (!val || (!val.includes("(") && !val.includes("#"))) continue;
      const next = remap(val, FG_PROPS.has(prop));
      if (next === val) continue; // unchanged or already our (idempotent) value
      inlineTouched.push({ el, prop, orig: val, prio: st.getPropertyPriority(prop) });
      st.setProperty(prop, next, "important");
    }
  }
}

function restoreInline() {
  for (const t of inlineTouched) t.el.style.setProperty(t.prop, t.orig, t.prio);
  inlineTouched = [];
}

/* --- Building overrides from the page's own rules. ------------------------ */
function ruleOverride(rule) {
  // Plain style rule.
  if (rule.style && rule.selectorText) {
    const decls = [];
    const s = rule.style;
    for (let i = 0; i < s.length; i++) {
      const prop = s.item(i);
      const val = s.getPropertyValue(prop);
      if (!val || (val.indexOf("(") === -1 && val.indexOf("#") === -1)) continue;
      const next = remap(val, FG_PROPS.has(prop));
      if (next !== val) decls.push(`${prop}:${next} !important`);
    }
    return decls.length ? `${rule.selectorText}{${decls.join(";")}}` : "";
  }
  // Conditional group (@media / @supports) — recurse. Skip @keyframes etc.
  if (rule.cssRules && (rule.conditionText || rule.media)) {
    let inner = "";
    for (const r of rule.cssRules) inner += ruleOverride(r);
    if (!inner) return "";
    const cond = rule.conditionText || rule.media.mediaText;
    return `@media ${cond}{${inner}}`;
  }
  return "";
}

/* --- Engine lifecycle. ---------------------------------------------------- */
let enabled = false;
let styleEl = null;
let observer = null;
let buffer = "";
let seen = new WeakMap(); // stylesheet -> count of already-processed rules
let scheduled = false;

function ensureStyle() {
  if (styleEl && styleEl.isConnected) return;
  styleEl = document.createElement("style");
  styleEl.id = "gloam-overrides";
  (document.head || document.documentElement).appendChild(styleEl);
}

function scan() {
  if (!enabled) return;
  ensureStyle();
  let added = "";
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode === styleEl) continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — not ours to read
    }
    if (!rules) continue;
    const start = seen.get(sheet) || 0;
    if (rules.length <= start) continue;
    for (let i = start; i < rules.length; i++) added += ruleOverride(rules[i]);
    seen.set(sheet, rules.length);
  }
  if (added) {
    buffer += added;
    styleEl.textContent = buffer;
  }
  applyInline();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
}

function enable() {
  if (enabled) return;
  enabled = true;
  document.documentElement.setAttribute(ATTR, "on");
  ensureStyle();
  scan();
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  // Safety-net rescans: styled-components inserts rules via the CSSOM, which
  // does not always coincide with an observed DOM mutation.
  [200, 600, 1500, 3000].forEach((t) => setTimeout(() => enabled && scan(), t));
  window.addEventListener("load", () => enabled && scan(), { once: true });
}

function disable() {
  if (!enabled) return;
  enabled = false;
  document.documentElement.removeAttribute(ATTR);
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (styleEl) {
    styleEl.remove();
    styleEl = null;
  }
  restoreInline();
  buffer = "";
  seen = new WeakMap();
}

/* --- Wire up to stored state. Default: enabled. --------------------------- */
api.storage.local.get("enabled").then((r) => {
  if (r.enabled !== false) enable();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;
  if (changes.enabled.newValue !== false) enable();
  else disable();
});
