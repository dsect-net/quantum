/**
 * Debug mode (Scotty-only): a persisted toggle that reveals dev
 * capabilities — service diagnostics, demo-mode overrides, and a log
 * viewer. Off by default; subtle by design.
 *
 * The log is an in-memory ring buffer (last 100 entries). Secrets are
 * never logged: callers must redact before writing.
 */
import { Preferences } from '@capacitor/preferences';

const DEBUG_KEY = 'quantum.debug';

export interface LogEntry {
  at: string; // ISO timestamp
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

const MAX_LOG = 100;
const ring: LogEntry[] = [];
const listeners = new Set<() => void>();

function emit(entry: LogEntry): void {
  ring.push(entry);
  while (ring.length > MAX_LOG) ring.shift();
  for (const fn of listeners) fn();
}

export function debugLog(tag: string, message: string, level: LogEntry['level'] = 'info'): void {
  emit({ at: new Date().toISOString(), level, tag, message });
}

/** Snapshot of the ring buffer, newest last. */
export function getLog(): LogEntry[] {
  return [...ring];
}

/** For tests: clear the buffer. */
export function clearLog(): void {
  ring.length = 0;
  for (const fn of listeners) fn();
}

/** Subscribe to new entries; returns an unsubscribe function. */
export function onLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function readStored(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: DEBUG_KEY });
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    // fall through
  }
  try {
    return window.localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export async function storeDebugMode(on: boolean): Promise<void> {
  const v = on ? '1' : '0';
  try {
    await Preferences.set({ key: DEBUG_KEY, value: v });
  } catch {
    // ignore — localStorage fallback below
  }
  try {
    window.localStorage.setItem(DEBUG_KEY, v);
  } catch {
    // ignore
  }
}

export async function loadDebugMode(): Promise<boolean> {
  return readStored();
}
