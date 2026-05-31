"use strict";

if (!globalThis.browser && globalThis.chrome) globalThis.browser = chrome;

/*
 * Toolbar toggle. Clicking the action flips a stored flag; content.js watches
 * storage and applies/removes the theme live. The badge reflects the state.
 */

const DEFAULT_ENABLED = true;

async function isEnabled() {
  const { enabled } = await browser.storage.local.get("enabled");
  return enabled !== false; // default on
}

async function refreshBadge(enabled) {
  await browser.action.setBadgeText({ text: enabled ? "" : "off" });
  await browser.action.setBadgeBackgroundColor({ color: "#6b6b66" });
  await browser.action.setTitle({
    title: enabled
      ? "Gloam: dark theme ON — click to disable"
      : "Gloam: dark theme OFF — click to enable",
  });
}

browser.action.onClicked.addListener(async () => {
  const next = !(await isEnabled());
  await browser.storage.local.set({ enabled: next });
  await refreshBadge(next);
});

browser.runtime.onInstalled.addListener(async () => {
  const { enabled } = await browser.storage.local.get("enabled");
  if (enabled === undefined) await browser.storage.local.set({ enabled: DEFAULT_ENABLED });
  await refreshBadge(await isEnabled());
});

browser.runtime.onStartup.addListener(async () => {
  await refreshBadge(await isEnabled());
});
