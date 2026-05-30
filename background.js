"use strict";

/*
 * Toolbar toggle. Clicking the action flips a stored flag; content.js watches
 * storage and applies/removes the theme live. The badge reflects the state.
 */

const api = typeof browser !== "undefined" ? browser : chrome;
const DEFAULT_ENABLED = true;

async function isEnabled() {
  const { enabled } = await api.storage.local.get("enabled");
  return enabled !== false; // default on
}

async function refreshBadge(enabled) {
  await api.action.setBadgeText({ text: enabled ? "" : "off" });
  await api.action.setBadgeBackgroundColor({ color: "#6b6b66" });
  await api.action.setTitle({
    title: enabled
      ? "Umbra: dark theme ON — click to disable"
      : "Umbra: dark theme OFF — click to enable",
  });
}

api.action.onClicked.addListener(async () => {
  const next = !(await isEnabled());
  await api.storage.local.set({ enabled: next });
  await refreshBadge(next);
});

api.runtime.onInstalled.addListener(async () => {
  const { enabled } = await api.storage.local.get("enabled");
  if (enabled === undefined) await api.storage.local.set({ enabled: DEFAULT_ENABLED });
  await refreshBadge(await isEnabled());
});

api.runtime.onStartup.addListener(async () => {
  await refreshBadge(await isEnabled());
});
