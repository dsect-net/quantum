/**
 * debug lib: ring buffer keeps the last 100 entries; secrets policy is
 * caller's job — the buffer itself just stores what it's given.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { clearLog, debugLog, getLog, loadDebugMode, onLog, storeDebugMode } from './debug';

describe('debug log', () => {
  beforeEach(() => clearLog());

  it('records entries newest-last', () => {
    debugLog('a', 'first');
    debugLog('b', 'second', 'warn');
    const log = getLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ tag: 'a', message: 'first', level: 'info' });
    expect(log[1]).toMatchObject({ tag: 'b', message: 'second', level: 'warn' });
    expect(typeof log[0].at).toBe('string');
  });

  it('caps the buffer at 100 entries', () => {
    for (let i = 0; i < 150; i++) debugLog('t', `m${i}`);
    const log = getLog();
    expect(log).toHaveLength(100);
    expect(log[0].message).toBe('m50');
    expect(log[99].message).toBe('m149');
  });

  it('notifies subscribers and unsubscribes', () => {
    let calls = 0;
    const off = onLog(() => calls++);
    debugLog('t', 'hello');
    expect(calls).toBe(1);
    off();
    debugLog('t', 'again');
    expect(calls).toBe(1);
  });

  it('persists the debug-mode toggle', async () => {
    await storeDebugMode(true);
    expect(await loadDebugMode()).toBe(true);
    await storeDebugMode(false);
    expect(await loadDebugMode()).toBe(false);
  });
});
