"use strict";

/*
 * Gloam — pure color logic (no DOM or browser APIs).
 *
 * Shared by the content script (loaded first via the manifest) and the unit
 * tests. The remap is value-based and role-aware: a light source color used as
 * a *background* becomes dark, while the same color used as *text* stays light.
 * A luminance fallback handles near-neutral shades not in the token table.
 *
 * It also builds the per-rule override string (ruleOverride): a CSS rule's shape
 * is read duck-typed, so this stays DOM-free and unit testable with plain objects.
 */

function rgb(r, g, b, to) {
  return { r, g, b, a: 1, to };
}
function warmInk(a, to) {
  return { r: 15, g: 12, b: 8, a, to };
}

// Native Claude dark elevation ladder — one warm-neutral hue, progressively
// lifted (base 38 → 46 → 53 → 58 → 73). Reused by the token table below and the
// luminance fallback so the two never drift apart.
const SURFACE = {
  base: "#262624", // app background
  low: "#2e2e2c",
  mid: "#353431", // cards, pills
  high: "#3a3a37", // header, buttons
  raised: "#4a4946", // most-lifted near-white surface (e.g. the active tab)
};

// Light source token -> native Claude dark token, matched by RGBA components
// so it survives CSSOM serialization (#faf9f5 -> rgb(250, 249, 245)) and the
// styled-components class-hash churn that changes on every Claude deploy.
const TOKENS = [
  // Surfaces & backgrounds. The elevation ladder (base 38 → 46 → 53 → 58)
  // stays on one warm-neutral hue (R≈G, B a couple lower) so each step reads
  // as the same charcoal lifted, not progressively olive.
  rgb(250, 249, 245, SURFACE.base), // #faf9f5 — app background (base)
  rgb(240, 238, 230, SURFACE.low), // #f0eee6 — surface (low)
  rgb(248, 247, 243, SURFACE.mid), // #f8f7f3 — surface (mid: cards, pills)
  rgb(255, 255, 255, SURFACE.high), // #ffffff — surface (high: header, buttons)
  rgb(236, 234, 228, SURFACE.base), // #eceae4 — overflow-fade gradient -> match bg
  rgb(227, 218, 204, "rgba(245, 244, 238, 0.14)"), // #e3dacc — divider (hairline)
  rgb(224, 222, 214, "rgba(245, 244, 238, 0.12)"), // #e0ded6 — border (hairline)
  rgb(253, 244, 238, "#33291f"), // #fdf4ee — warm (orange-tinted) card bg
  rgb(240, 201, 181, "#6b4a32"), // #f0c9b5 — warm card border
  rgb(25, 25, 21, SURFACE.high), // #191915 — primary button surface
  rgb(43, 43, 38, SURFACE.high), // #2b2b26 — primary button (variant) surface
  rgb(204, 204, 204, "rgba(245, 244, 238, 0.12)"), // #ccc — gray border -> hairline
  rgb(17, 17, 17, "rgba(245, 244, 238, 0.95)"), // #111 — base body text

  // Near-black chips/blocks that read as dark elements on the light theme
  // (tool-call pills, code/terminal). On dark they'd be dark-on-dark, so lift
  // them to a visible raised surface. (Opaque only — alpha shadows stay dark.)
  rgb(26, 26, 26, SURFACE.mid), // #1a1a1a
  rgb(34, 34, 34, SURFACE.mid), // #222
  rgb(13, 13, 13, "#2c2c2a"), // #0d0d0d — darkest (code) -> slightly lifted
  rgb(0, 0, 0, SURFACE.mid), // #000

  // Text & hairline borders (warm near-black at varying alpha). Split by alpha
  // so we recolor text/borders but leave shadows (0.25 / 0.15) dark.
  warmInk(0.92, "rgba(245, 244, 238, 0.95)"), // primary text
  warmInk(0.64, "rgba(245, 244, 238, 0.66)"), // secondary text
  warmInk(0.6, "rgba(245, 244, 238, 0.55)"), // tertiary text
  warmInk(0.1, "rgba(245, 244, 238, 0.12)"), // border
  warmInk(0.08, "rgba(245, 244, 238, 0.09)"), // subtle border
  warmInk(0.04, "rgba(245, 244, 238, 0.06)"), // hover wash

  // Accent: lift the deep terracotta text so it reads on a dark surface while
  // staying recognizably terracotta (not pale salmon).
  rgb(168, 78, 46, "#e0805f"), // #a84e2e

  // Accent-button glow: the warm orange box-shadow turns into a muddy brown
  // halo on a dark base. Swap it for a clean soft shadow so the button reads
  // as raised, not dirty.
  { r: 180, g: 90, b: 30, a: 0.35, to: "rgba(0, 0, 0, 0.33)" }, // rgba(180,90,30,.35)
  { r: 180, g: 90, b: 30, a: 0.2, to: "rgba(0, 0, 0, 0.2)" }, // rgba(180,90,30,.2)
];

const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

// url(...) can hold hex-looking ids (e.g. a gradient/filter ref like url(#fff))
// that are NOT colors. We remap only the spans outside any url(...).
const URL_RE = /url\([^)]*\)/gi;

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

function luminance(c) {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

const LIGHT_TEXT = "rgba(245, 244, 238, 0.95)";

// Classification thresholds. Luminance is 0–1; saturation is a 0–255 channel
// span; alpha is 0–1.
const TOKEN_ALPHA_EPS = 0.02; // alpha match tolerance in the token table
const NEUTRAL_MAX_SATURATION = 24; // above this it's a colored accent — leave it
const LIGHT_LUM = 0.5; // ≥ reads as a light color, < as dark
const MIN_OPAQUE_ALPHA = 0.5; // a surface must be ≥ half-opaque to recolor
const DARK_TEXT_MAX_LUM = 0.4; // dark neutral text below this lifts to LIGHT_TEXT
const SURFACE_LUM_HI = 0.92; // fallback elevation breakpoints: lighter -> SURFACE.mid
const SURFACE_LUM_MID = 0.78; // ...then SURFACE.high, else SURFACE.raised
const WHITE_HIGHLIGHT_MAX_ALPHA = 0.2; // fainter white inset highlights are kept
const WHITE_TINT_MAX_ALPHA = 0.1; // heavier white fills soften to at most this
const WHITE_TINT_FACTOR = 0.18; // ...scaled from their original alpha

function mapColor(literal, foreground) {
  const c = parseColor(literal);
  if (!c) return literal;

  // Semi-transparent white serves two roles: subtle inset highlights (low
  // alpha — keep them, they give buttons a raised sheen on dark) and hover/tab
  // fills (higher alpha — these composite into a heavy grey on our dark base,
  // so soften them to a gentle light tint).
  if (!foreground && c.a < 1 && c.r === 255 && c.g === 255 && c.b === 255) {
    if (c.a < WHITE_HIGHLIGHT_MAX_ALPHA) return literal;
    const tint = Math.min(WHITE_TINT_MAX_ALPHA, c.a * WHITE_TINT_FACTOR);
    return `rgba(245, 244, 238, ${tint.toFixed(3)})`;
  }

  for (const t of TOKENS) {
    if (t.r === c.r && t.g === c.g && t.b === c.b && Math.abs(t.a - c.a) < TOKEN_ALPHA_EPS) {
      if (foreground) {
        if (luminance(c) > LIGHT_LUM) return literal; // light text stays light
        const target = parseColor(t.to);
        // Dark text -> lighten; if the token's target is itself dark (a surface
        // mapping), fall back to the primary light text color.
        if (target && luminance(target) < LIGHT_LUM) return LIGHT_TEXT;
      }
      return t.to;
    }
  }

  // Fallback for near-neutral colors not in the token table, so we don't have
  // to enumerate every shade the app uses (e.g. #faf8f4 in the active-tab
  // gradient, #dbd9d4 tab borders). Saturated colors (accents) are left alone.
  const saturation = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  if (saturation <= NEUTRAL_MAX_SATURATION) {
    const lum = luminance(c);
    if (foreground) {
      if (lum < DARK_TEXT_MAX_LUM) return LIGHT_TEXT; // dark neutral text -> light
    } else if (c.a >= MIN_OPAQUE_ALPHA && lum > LIGHT_LUM) {
      // Light neutral surface -> a dark one, lifted the lighter it was, so a
      // near-white raised element (e.g. the active tab) reads as raised above
      // the base instead of collapsing onto it.
      return lum > SURFACE_LUM_HI
        ? SURFACE.raised
        : lum > SURFACE_LUM_MID
          ? SURFACE.high
          : SURFACE.mid;
    }
  }
  return literal;
}

function remap(value, foreground) {
  const sub = (s) => s.replace(COLOR_RE, (m) => mapColor(m, foreground));
  if (value.indexOf("url(") === -1) return sub(value);
  // Remap only the spans between url(...) refs, leaving each url(...) verbatim.
  let out = "";
  let last = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(value)) !== null) {
    out += sub(value.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + sub(value.slice(last));
}

// Properties that paint text/icons (foreground). A light source color on these
// must STAY light on dark; on any other property the same color is a surface and
// goes dark. Shared with the content script (same content-script scope).
const FG_PROPS = new Set([
  "color",
  "-webkit-text-fill-color",
  "fill",
  "stroke",
  "caret-color",
  "text-decoration-color",
]);

// Build a CSS override string for one CSS rule by remapping its color-bearing
// declarations. The rule's shape is read duck-typed (no DOM API) so it is unit
// testable with plain objects. Returns "" when nothing needs overriding.
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
  // Conditional group rule — recurse, then re-wrap with the CORRECT at-rule.
  // Distinguish by shape, not instanceof (this runs in Node tests too): only
  // CSSMediaRule exposes `.media`, only CSSContainerRule exposes
  // `.containerQuery`; `.conditionText` exists on both media and supports, so it
  // must be checked last. A @supports/@container wrapped as @media is invalid
  // and the parser drops the whole block.
  if (rule.cssRules) {
    let inner = "";
    for (const r of rule.cssRules) inner += ruleOverride(r);
    if (!inner) return "";
    if (rule.media) return `@media ${rule.media.mediaText}{${inner}}`;
    if (rule.containerQuery !== undefined) {
      const name = rule.containerName ? `${rule.containerName} ` : "";
      return `@container ${name}${rule.containerQuery}{${inner}}`;
    }
    if (rule.conditionText) return `@supports ${rule.conditionText}{${inner}}`;
  }
  // Other rules (@keyframes, @font-face, …) carry no themeable colors.
  return "";
}

// The content script (loaded after this file in the same content_scripts entry)
// shares this scope and calls `remap` / `mapColor` directly by name. The export
// below is only for the Node unit tests.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    rgb,
    warmInk,
    TOKENS,
    COLOR_RE,
    parseColor,
    luminance,
    LIGHT_TEXT,
    mapColor,
    remap,
    FG_PROPS,
    ruleOverride,
  };
}
