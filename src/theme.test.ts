/**
 * Theme: Quantum boots dark (DSECT dark-first) and sets a literal
 * data-theme="dark" on <html> — the Untitled bridge and tokens.css drive
 * dark mode off that attribute, not the kit's attribute-removal default.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, bootTheme } from './theme';

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('boots dark by default', async () => {
    const theme = await bootTheme();
    expect(theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applyTheme sets the data-theme attribute explicitly', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
