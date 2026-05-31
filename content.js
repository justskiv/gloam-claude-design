"use strict";

/*
 * Gloam — dark theme engine for the Claude Design native panels.
 *
 * Pure color logic lives in color.js (loaded first via the manifest, also unit
 * tested). This file is the DOM glue: it reads the page's own stylesheet and
 * inline colors, remaps them by value, and writes the result into a single
 * injected <style> plus minimal inline overrides.
 *
 * The design preview lives in a cross-origin <iframe> (claudeusercontent.com):
 * it doesn't match our injection, and its stylesheets aren't readable from this
 * document (cross-origin cssRules throws, and we skip those), so the engine
 * never touches it — the preview is left untouched.
 *
 * Toggling: the page's own rules are never mutated. Overrides go into one
 * injected <style>; inline edits remember the value they replaced. Disabling
 * removes the <style> and the gating attribute and writes the remembered values
 * back (where the page hasn't since written a newer one of its own).
 */

/* global remap, FG_PROPS, ruleOverride */
// These are defined in color.js, which the manifest loads first into this same
// content-script scope (files in one content_scripts entry share one scope).

const ATTR = "data-gloam";

// Some surfaces (e.g. the top bar) get their color from an inline style, which
// stylesheet overrides can't reach. We rewrite those directly and remember the
// value we replaced so disabling can restore it.
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

// Per touched (element, property) we keep { source, prio, applied }: `source`
// is the page-authored value to restore on disable, `applied` is the serialized
// value we last wrote. The WeakMap lets dead nodes be collected; the Set is an
// iterable companion for restore (a WeakMap isn't enumerable) and is cleared on
// disable.
const inlineStore = new WeakMap(); // Element -> Map<prop, { source, prio, applied }>
const touchedEls = new Set();

function recolorInline(el) {
  const st = el.style;
  let store = inlineStore.get(el);
  for (const prop of INLINE_PROPS) {
    const current = st.getPropertyValue(prop);
    if (!current || (!current.includes("(") && !current.includes("#"))) continue;
    const rec = store && store.get(prop);
    if (rec && current === rec.applied) continue; // our value is still in effect
    // Otherwise the page authored `current` (first sight, or re-authored after a
    // render): it becomes the value to restore. Read our write back so `applied`
    // holds the SERIALIZED form (#262624 reads back as rgb(38, 38, 36)).
    const next = remap(current, FG_PROPS.has(prop));
    if (next === current) continue; // page value maps to itself — nothing to do
    if (!store) {
      store = new Map();
      inlineStore.set(el, store);
      touchedEls.add(el);
    }
    const prio = st.getPropertyPriority(prop);
    st.setProperty(prop, next, "important");
    store.set(prop, { source: current, prio, applied: st.getPropertyValue(prop) });
  }
}

function applyInline() {
  for (const el of document.querySelectorAll("[style]")) recolorInline(el);
}

function restoreInline() {
  for (const el of touchedEls) {
    const store = inlineStore.get(el);
    if (store) {
      for (const [prop, rec] of store) {
        // Undo only where our value is still in effect; if the page wrote a newer
        // value since, leave it. An empty `applied` (a shorthand that didn't
        // serialize back) can't be compared — restore unconditionally.
        if (!rec.applied || el.style.getPropertyValue(prop) === rec.applied) {
          el.style.setProperty(prop, rec.source, rec.prio);
        }
      }
    }
    inlineStore.delete(el);
  }
  touchedEls.clear();
}

/* --- Engine lifecycle. ---------------------------------------------------- */
const OBSERVE_OPTS = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["style"],
};

let enabled = false;
let styleEl = null;
let observer = null;
let scheduled = false;
const pendingInline = new Set(); // elements whose inline style needs a recolor
const unreadable = new WeakSet(); // cross-origin sheets we can't read — skip them

function ensureStyle() {
  if (styleEl && styleEl.isConnected) return;
  styleEl = document.createElement("style");
  styleEl.id = "gloam-overrides";
  (document.head || document.documentElement).appendChild(styleEl);
}

// Rebuild the whole override sheet from the CURRENT CSSOM. Rebuilding (not
// appending) is what lets us follow styled-components recycling its rule slots:
// removed / reordered / replaced rules are reflected each pass, with no stale
// leftovers and a single parse instead of an ever-growing one.
function buildSheetOverrides() {
  let css = "";
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode === styleEl || unreadable.has(sheet)) continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      if (e.name === "SecurityError") unreadable.add(sheet); // cross-origin, forever
      continue;
    }
    if (!rules) continue;
    for (const rule of rules) css += ruleOverride(rule);
  }
  return css;
}

function flush() {
  scheduled = false;
  if (!enabled) return;
  ensureStyle();
  // Apply with the observer detached so we don't react to our own writes (the
  // injected <style> text and the inline edits). JS is single-threaded, so no
  // real page mutation can slip past during this synchronous block.
  observer.disconnect();
  try {
    styleEl.textContent = buildSheetOverrides();
    for (const el of pendingInline) recolorInline(el);
  } finally {
    pendingInline.clear();
    if (enabled) observer.observe(document.documentElement, OBSERVE_OPTS);
  }
}

function schedule() {
  if (scheduled || !enabled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

function onMutations(records) {
  for (const rec of records) {
    if (rec.type === "attributes") {
      pendingInline.add(rec.target); // its style attribute changed
    } else {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue; // elements only
        if (node.hasAttribute("style")) pendingInline.add(node);
        for (const el of node.querySelectorAll("[style]")) pendingInline.add(el);
      }
    }
  }
  schedule();
}

function enable() {
  if (enabled) return;
  enabled = true;
  document.documentElement.setAttribute(ATTR, "on");
  ensureStyle();
  // One full pass before observing, so these initial writes aren't re-processed.
  styleEl.textContent = buildSheetOverrides();
  applyInline();
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, OBSERVE_OPTS);
  // Safety-net rescans: styled-components inserts rules via the CSSOM, which does
  // not always coincide with an observed DOM mutation.
  [200, 600, 1500, 3000].forEach((t) => setTimeout(() => enabled && schedule(), t));
  window.addEventListener("load", () => enabled && schedule(), { once: true });
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
  pendingInline.clear();
}

/* --- Wire up to stored state. Default: enabled. --------------------------- */
// Belt-and-suspenders: only operate on the Claude Design tool itself. The URL
// match already restricts injection, so this just rejects any stray frame (e.g.
// an about:srcdoc/blob document) that should never be themed.
const isDesignPanel =
  location.hostname === "claude.ai" &&
  (location.pathname === "/design" || location.pathname.startsWith("/design/"));

if (isDesignPanel) {
  browser.storage.local.get("enabled").then((r) => {
    if (r.enabled !== false) enable();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    if (changes.enabled.newValue !== false) enable();
    else disable();
  });
}
