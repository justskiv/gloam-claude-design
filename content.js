"use strict";

/*
 * Umbra — native-looking dark theme for the Claude Design native panels.
 *
 * Strategy: recolor by *value*, not by class name. Claude's app paints its
 * chrome with a fixed set of warm "paper" design tokens (cream backgrounds,
 * near-black text). We read the page's own stylesheets, find those exact
 * tokens and emit override rules that map each one to Claude's native dark
 * token. Matching is done on parsed RGBA components, so it survives both
 * CSSOM color serialization (#faf9f5 -> rgb(250, 249, 245)) and the styled-
 * components class-hash churn that changes on every Claude deploy.
 *
 * The design preview lives in a cross-origin <iframe> (claudeusercontent.com),
 * whose stylesheets are not part of this document — so it is physically
 * impossible for this engine to touch it. The preview stays pixel-identical.
 *
 * Toggling: we never mutate the page's own rules. All overrides go into a
 * single injected <style>. Disabling removes that element and the gating
 * attribute, leaving the page byte-for-byte unchanged.
 */

const ATTR = "data-umbra";
const api = typeof browser !== "undefined" ? browser : chrome;

/* --- Color token map: light source token -> native Claude dark token. ----
 * Each entry matches a source color by its RGBA components. `a` is the source
 * alpha; opaque colors use 1. Colors not listed here are left untouched
 * (e.g. shadows, the #d97757 accent, code/terminal blacks). */
const TOKENS = [
  // Surfaces & backgrounds. The elevation ladder is deliberately spread out
  // (base 38 → 46 → 52 → 58) so cards/pills/toolbars read clearly against the
  // base instead of sitting "dark on dark".
  rgb(250, 249, 245, "#262624"), // #faf9f5 — app background (base)
  rgb(240, 238, 230, "#2e2d2a"), // #f0eee6 — secondary surface
  rgb(248, 247, 243, "#34332f"), // #f8f7f3 — card / tool-call pill
  rgb(255, 255, 255, "#3a3935"), // #ffffff — raised card / header / button
  rgb(236, 234, 228, "#262624"), // #eceae4 — overflow-fade gradient -> match bg
  rgb(227, 218, 204, "#4a4842"), // #e3dacc — divider (stronger)
  rgb(224, 222, 214, "#4a4842"), // #e0ded6 — border (stronger)
  rgb(253, 244, 238, "#352b24"), // #fdf4ee — warm (orange-tinted) card bg
  rgb(240, 201, 181, "#5f4836"), // #f0c9b5 — warm card border
  rgb(25, 25, 21, "#3f3e39"), // #191915 — primary button surface
  rgb(43, 43, 38, "#3f3e39"), // #2b2b26 — primary button (variant/hover) surface
  rgb(204, 204, 204, "#4a4842"), // #ccc — gray border
  rgb(17, 17, 17, "#e8e6dc"), // #111 — base body text

  // Near-black chips/blocks that read as dark elements on the light theme
  // (tool-call pills, code/terminal). On dark they'd be dark-on-dark, so lift
  // them to a visible raised surface. (Opaque only — alpha shadows stay dark.)
  rgb(26, 26, 26, "#34332f"), // #1a1a1a
  rgb(34, 34, 34, "#34332f"), // #222
  rgb(13, 13, 13, "#2c2b27"), // #0d0d0d — darkest (code) -> slightly lifted
  rgb(0, 0, 0, "#34332f"), // #000

  // Text & hairline borders (warm near-black at varying alpha). Split by
  // alpha so we recolor text/borders but leave shadows (0.25 / 0.15) dark.
  warmInk(0.92, "rgba(245, 244, 238, 0.92)"), // primary text
  warmInk(0.64, "rgba(245, 244, 238, 0.6)"), // secondary text
  warmInk(0.6, "rgba(245, 244, 238, 0.52)"), // tertiary text
  warmInk(0.1, "rgba(245, 244, 238, 0.14)"), // border
  warmInk(0.08, "rgba(245, 244, 238, 0.11)"), // subtle border
  warmInk(0.04, "rgba(245, 244, 238, 0.07)"), // hover wash

  // Accent: lift the deep terracotta text so it reads on a dark surface.
  rgb(168, 78, 46, "#e8916f"), // #a84e2e
];

function rgb(r, g, b, to) {
  return { r, g, b, a: 1, to };
}
function warmInk(a, to) {
  return { r: 15, g: 12, b: 8, a, to };
}

/* --- Color parsing (serialization-independent). --------------------------- */
const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

function hexByte(h, i) {
  return parseInt(h.slice(i, i + 2), 16);
}

function parseColor(str) {
  const s = str.trim().toLowerCase();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (h.length === 6) return { r: hexByte(h, 0), g: hexByte(h, 2), b: hexByte(h, 4), a: 1 };
    if (h.length === 8) {
      return { r: hexByte(h, 0), g: hexByte(h, 2), b: hexByte(h, 4), a: hexByte(h, 6) / 255 };
    }
    return null;
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[,/\s]+/).filter(Boolean);
  const r = parseFloat(parts[0]);
  const g = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  if ([r, g, b].some(Number.isNaN)) return null;
  let a = 1;
  if (parts[3] !== undefined) {
    a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  }
  return { r, g, b, a };
}

// Foreground properties paint text/icons, so they follow the opposite rule
// from backgrounds: a light source color must STAY light on a dark theme
// (e.g. a button label colored #FAF9F5 — the same token as the app
// background, but here it's text). Without this, the value remap would darken
// button text to match the app background, leaving it unreadable.
const FG_PROPS = new Set([
  "color",
  "-webkit-text-fill-color",
  "fill",
  "caret-color",
  "text-decoration-color",
]);

function luminance(c) {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

const LIGHT_TEXT = "rgba(245, 244, 238, 0.92)";

function mapColor(literal, foreground) {
  const c = parseColor(literal);
  if (!c) return literal;

  // Semi-transparent white is used for hover/highlight fills; over our dark
  // base it would composite into a heavy grey, so render it as a gentle light
  // tint (a subtle lift) instead.
  if (!foreground && c.a < 1 && c.r === 255 && c.g === 255 && c.b === 255) {
    return `rgba(245, 244, 238, ${Math.min(0.1, c.a * 0.18).toFixed(3)})`;
  }

  for (const t of TOKENS) {
    if (t.r === c.r && t.g === c.g && t.b === c.b && Math.abs(t.a - c.a) < 0.02) {
      if (foreground) {
        if (luminance(c) > 0.5) return literal; // light text stays light
        const target = parseColor(t.to);
        // Dark text -> lighten; if the token's target is itself dark (a surface
        // mapping), fall back to the primary light text color.
        if (target && luminance(target) < 0.5) return LIGHT_TEXT;
      }
      return t.to;
    }
  }

  // Fallback for near-neutral colors not in the token table, so we don't have
  // to enumerate every shade the app uses (e.g. #faf8f4 in the active-tab
  // gradient, #dbd9d4 tab borders). Saturated colors (accents) are left alone.
  const saturation = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  if (saturation <= 24) {
    const lum = luminance(c);
    if (foreground) {
      if (lum < 0.4) return LIGHT_TEXT; // dark neutral text -> light
    } else if (c.a >= 0.5 && lum > 0.5) {
      // Light/mid neutral surface/border -> a dark surface, scaled by how light
      // it was so gradients keep a subtle step.
      return lum > 0.92 ? "#34332f" : lum > 0.78 ? "#3f3e39" : "#4a4842";
    }
  }
  return literal;
}

function remap(value, foreground) {
  return value.replace(COLOR_RE, (m) => mapColor(m, foreground));
}

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
  styleEl.id = "umbra-overrides";
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
