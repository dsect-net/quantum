/**
 * Quantum theme boot. Scotty chose the DSECT Light theme as the default
 * (Oct 2026 feedback round) — the choice persists across launches.
 * Two things must agree:
 *
 *  1. The design-system kit's `setTheme('light')` — the canonical call.
 *  2. A literal `data-theme="light"` attribute on <html> — the kit's
 *     `setTheme('dark')` *removes* the attribute, but the Untitled bridge
 *     (`untitled/dsect-theme.css`) and tokens.css drive theming off the
 *     explicit `[data-theme]` attribute, so Quantum always sets it.
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
  const theme: Theme = stored ?? 'light'; // DSECT Light default (Scotty's call)
  applyTheme(theme);
  return theme;
}
