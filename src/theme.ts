/**
 * Quantum theme boot. DSECT is dark-first: Quantum boots dark and persists
 * the choice. Two things must agree:
 *
 *  1. The design-system kit's `setTheme('dark')` — the canonical call.
 *  2. A literal `data-theme="dark"` attribute on <html> — the kit's
 *     `setTheme('dark')` *removes* the attribute, but the Untitled bridge
 *     (`untitled/dsect-theme.css`) and tokens.css drive dark mode off
 *     `[data-theme="dark"]`, so Quantum sets it explicitly.
 */
import { setTheme as kitSetTheme } from '@dsect/ui/theme';
import type { Theme } from '@dsect/ui/theme';
import { Preferences } from '@capacitor/preferences';

const THEME_KEY = 'quantum.theme';

async function readStored(): Promise<Theme | null> {
  try {
    const { value } = await Preferences.get({ key: THEME_KEY });
    if (value === 'dark' || value === 'light') return value;
  } catch {
    // Preferences unavailable (e.g. unit tests) — fall through.
  }
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    // ignore
  }
  return null;
}

export async function storeTheme(theme: Theme): Promise<void> {
  try {
    await Preferences.set({ key: THEME_KEY, value: theme });
  } catch {
    // ignore — localStorage fallback below
  }
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function applyTheme(theme: Theme): void {
  kitSetTheme(theme);
  // tokens.css + the Untitled bridge key off this attribute. `setTheme('dark')`
  // alone removes it; Quantum always sets it explicitly so dark is real.
  document.documentElement.setAttribute('data-theme', theme);
}

export async function bootTheme(): Promise<Theme> {
  const stored = await readStored();
  const theme: Theme = stored ?? 'dark'; // dark-first default
  applyTheme(theme);
  return theme;
}
