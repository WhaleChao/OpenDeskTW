// SPDX-License-Identifier: AGPL-3.0-or-later
export function readPreference(storage, key, fallback) {
  try { return storage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writePreference(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch { return false; }
}
export function recentPaths(storage) {
  try {
    const values = JSON.parse(readPreference(storage, "opendesk-recent", "[]"));
    return Array.isArray(values) ? [...new Set(values.filter(value => typeof value === "string" && value.trim()))].slice(0, 12) : [];
  } catch { return []; }
}
export function themePreference(value) { return ["system", "light", "dark"].includes(value) ? value : "system"; }
export function resolvedTheme(preference, systemDark) { return preference === "system" ? (systemDark ? "dark" : "light") : themePreference(preference); }
