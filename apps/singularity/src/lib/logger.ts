/**
 * Client logger — in-memory ring buffer feeding the developer-mode log
 * viewer (docs/MEMORY.md — developer mode is a settings toggle). Secrets are
 * never logged: callers must redact before writing (the API client never
 * passes tokens to this logger).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  tag: string;
  message: string;
}

const MAX_ENTRIES = 200;
const ring: LogEntry[] = [];
const listeners = new Set<() => void>();

function emit(entry: LogEntry): void {
  ring.push(entry);
  while (ring.length > MAX_ENTRIES) ring.shift();
  for (const fn of listeners) fn();
}

export function log(tag: string, message: string, level: LogLevel = 'info'): void {
  emit({ at: new Date().toISOString(), level, tag, message });
}

/** Snapshot of the ring, newest last. */
export function getLog(): LogEntry[] {
  return [...ring];
}

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
