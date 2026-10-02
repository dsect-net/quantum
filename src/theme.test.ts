/**
 * Theme: Quantum boots the DSECT Light theme (Scotty's Oct 2026 call) and
 * sets a literal data-theme="light" on <html> — the Untitled bridge and
 * tokens.css drive theming off that attribute, not the kit's
 * attribute-removal default.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, bootTheme } from './theme';

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('boots the DSECT Light theme by default', async () => {
    const theme = await bootTheme();
    expect(theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applyTheme sets the data-theme attribute explicitly', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
