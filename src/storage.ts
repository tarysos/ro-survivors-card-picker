import { sanitizeSettings, STORAGE_KEY } from './core';
import type { Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeSettings(result[STORAGE_KEY]);
}
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettings(settings) });
}
