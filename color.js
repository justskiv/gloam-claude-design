"use strict";

/*
 * Gloam — pure color logic (no DOM or browser APIs).
 *
 * Shared by the content script (loaded first via the manifest) and the unit
 * tests. The remap is value-based and role-aware: a light source color used as
 * a *background* becomes dark, while the same color used as *text* stays light.
 * A luminance fallback handles near-neutral shades not in the token table.
 */

function rgb(r, g, b, to) {
  return { r, g, b, a: 1, to };
}
function warmInk(a, to) {
  return { r: 15, g: 12, b: 8, a, to };
}

// Light source token -> native Claude dark token, matched by RGBA components
// so it survives CSSOM serialization (#faf9f5 -> rgb(250, 249, 245)) and the
// styled-components class-hash churn that changes on every Claude deploy.
const TOKENS = [
  // Surfaces & backgrounds. The elevation ladder (base 38 → 46 → 53 → 58)
  // stays on one warm-neutral hue (R≈G, B a couple lower) so each step reads
  // as the same charcoal lifted, not progressively olive.
  rgb(250, 249, 245, "#262624"), // #faf9f5 — app background (base)
  rgb(240, 238, 230, "#2e2e2c"), // #f0eee6 — surface (low)
  rgb(248, 247, 243, "#353431"), // #f8f7f3 — surface (mid: cards, pills)
  rgb(255, 255, 255, "#3a3a37"), // #ffffff — surface (high: header, buttons)
  rgb(236, 234, 228, "#262624"), // #eceae4 — overflow-fade gradient -> match bg
  rgb(227, 218, 204, "rgba(245, 244, 238, 0.14)"), // #e3dacc — divider (hairline)
  rgb(224, 222, 214, "rgba(245, 244, 238, 0.12)"), // #e0ded6 — border (hairline)
  rgb(253, 244, 238, "#33291f"), // #fdf4ee — warm (orange-tinted) card bg
  rgb(240, 201, 181, "#6b4a32"), // #f0c9b5 — warm card border
  rgb(25, 25, 21, "#3a3a37"), // #191915 — primary button surface
  rgb(43, 43, 38, "#3a3a37"), // #2b2b26 — primary button (variant) surface
  rgb(204, 204, 204, "rgba(245, 244, 238, 0.12)"), // #ccc — gray border -> hairline
  rgb(17, 17, 17, "rgba(245, 244, 238, 0.95)"), // #111 — base body text

  // Near-black chips/blocks that read as dark elements on the light theme
  // (tool-call pills, code/terminal). On dark they'd be dark-on-dark, so lift
  // them to a visible raised surface. (Opaque only — alpha shadows stay dark.)
  rgb(26, 26, 26, "#353431"), // #1a1a1a
  rgb(34, 34, 34, "#353431"), // #222
  rgb(13, 13, 13, "#2c2c2a"), // #0d0d0d — darkest (code) -> slightly lifted
  rgb(0, 0, 0, "#353431"), // #000

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

function mapColor(literal, foreground) {
  const c = parseColor(literal);
  if (!c) return literal;

  // Semi-transparent white serves two roles: subtle inset highlights (low
  // alpha — keep them, they give buttons a raised sheen on dark) and hover/tab
  // fills (higher alpha — these composite into a heavy grey on our dark base,
  // so soften them to a gentle light tint).
  if (!foreground && c.a < 1 && c.r === 255 && c.g === 255 && c.b === 255) {
    if (c.a < 0.2) return literal;
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
      return lum > 0.92 ? "#353431" : lum > 0.78 ? "#3a3a37" : "#42413e";
    }
  }
  return literal;
}

function remap(value, foreground) {
  return value.replace(COLOR_RE, (m) => mapColor(m, foreground));
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
  };
}
