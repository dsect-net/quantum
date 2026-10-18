/**
 * On-device persistence — service URL, session, theme, developer mode.
 *
 * Storage rules (docs/MEMORY.md — identity & secrets): credentials/sessions
 * live only on this device (localStorage here; the Capacitor build can swap
 * in @capacitor/preferences via the same interface). Nothing secret is ever
 * logged or sent anywhere but the configured service.
 */
import type { Session } from '../api/client';
import type { User } from '../api/types';

const KEYS = {
  baseUrl: 'singularity.baseUrl',
  session: 'singularity.session',
  theme: 'singularity.theme',
  developerMode: 'singularity.developerMode',
} as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage full/private mode — features degrade, never crash.
  }
}

export function loadBaseUrl(): string {
  return read(KEYS.baseUrl) ?? '';
}

export function saveBaseUrl(url: string): void {
  write(KEYS.baseUrl, url.trim());
}

export function loadSession(): Session | null {
  const raw = read(KEYS.session);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.user?.handle) return null;
    if (parsed.expires_at && new Date(parsed.expires_at).getTime() < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  if (!session) {
    write(KEYS.session, null);
    return;
  }
  write(KEYS.session, JSON.stringify(session));
}

export type Theme = 'light' | 'dark';

export function loadTheme(): Theme {
  return read(KEYS.theme) === 'dark' ? 'dark' : 'light'; // light default (DSECT)
}

export function saveTheme(theme: Theme): void {
  write(KEYS.theme, theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function loadDeveloperMode(): boolean {
  return read(KEYS.developerMode) === '1';
}

export function saveDeveloperMode(on: boolean): void {
  write(KEYS.developerMode, on ? '1' : '0');
}

/** Convenience for screens: the signed-in user or null. */
export function loadUser(): User | null {
  return loadSession()?.user ?? null;
}
