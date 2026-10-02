/**
 * App shell: all 5 tabs render and navigate; the kit CSS (layered Tailwind
 * entry, tokens, Untitled bridge) imports without crashing.
 *
 * Oct 2026 feedback round: Messages → Mail rename, upper-right debug
 * toggle gating the Debug tools screen, long-press on tabs jumping to
 * Connection settings.
 */
import './index.css';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

const TAB_LABELS = ['Home', 'Chat', 'Create', 'Mail', 'More'];

function tabButton(label: string): HTMLButtonElement {
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  return Array.from(nav.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  )! as HTMLButtonElement;
}

describe('App shell', () => {
  it('renders all 5 tabs', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of TAB_LABELS) {
      const buttons = Array.from(nav.querySelectorAll('button'));
      expect(buttons.some((b) => b.textContent === label)).toBe(true);
    }
  });

  it('marks the Home tab current on launch', () => {
    render(<App />);
    const home = tabButton('Home');
    expect(home).toHaveAttribute('aria-current', 'page');
  });

  it('shows the real Create module (honest demo state when Nebula is unconfigured)', () => {
    render(<App />);
    const create = tabButton('Create');
    fireEvent.click(create);
    expect(screen.getAllByText('Create').length).toBeGreaterThanOrEqual(1);
    // Create is built now: sub-views + the honest degraded state, no Phase-4 placeholder.
    const tabs = screen.getByRole('tablist', { name: 'Create views' });
    for (const label of ['New', 'Jobs', 'Gallery']) {
      expect(
        Array.from(tabs.querySelectorAll('button')).some((b) => b.textContent === label),
      ).toBe(true);
    }
    // No Nebula URL in test settings → DemoBanner, naming the fix.
    expect(screen.getByText(/No Nebula base URL configured/)).toBeInTheDocument();
  });

  it('reaches the real Connection settings screen from More', () => {
    render(<App />);
    fireEvent.click(tabButton('More'));
    fireEvent.click(screen.getByRole('button', { name: /Connection settings/ }));
    // AppBar title + screen heading both name it (the h1 also carries the subtitle).
    expect(
      screen.getAllByText('Connection settings').length,
    ).toBeGreaterThanOrEqual(1);
    // Per-service fields, all empty by default (honest demo mode).
    expect(screen.getByLabelText(/Hub API base URL/)).toHaveValue('');
    expect(screen.getByLabelText(/Nebula base URL/)).toHaveValue('');
    expect(screen.getByLabelText(/Relay \(agent chat\) base URL/)).toHaveValue('');
  });

  it('rejects a malformed URL in the settings form', () => {
    render(<App />);
    fireEvent.click(tabButton('More'));
    fireEvent.click(screen.getByRole('button', { name: /Connection settings/ }));
    const input = screen.getByLabelText(/Hub API base URL/);
    fireEvent.change(input, { target: { value: 'not a url' } });
    expect(
      screen.getByText(/Enter a full URL starting with http/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('shows the Mail tab (renamed from Messages)', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    fireEvent.click(tabButton('Mail'));
    // AppBar heading carries the tab title (plus the "Quantum · DSECT" subtitle).
    expect(screen.getByRole('heading', { name: /Mail/ })).toBeInTheDocument();
    // No "Messages" tab remains.
    expect(
      Array.from(nav.querySelectorAll('button')).some((b) => b.textContent === 'Messages'),
    ).toBe(false);
  });

  it('hides debug tools behind the upper-right toggle (off by default)', async () => {
    render(<App />);
    // Toggle exists in the app bar with an accessible name.
    const toggle = screen.getByRole('switch', { name: 'Debug mode' });
    expect(toggle).not.toBeChecked();
    // No debug entry point while off.
    fireEvent.click(tabButton('More'));
    expect(screen.queryByRole('button', { name: /Debug tools/ })).not.toBeInTheDocument();

    // Flip it on: the debug row appears under More.
    fireEvent.click(toggle);
    const row = await screen.findByRole('button', { name: /Debug tools/ });
    fireEvent.click(row);
    expect(screen.getByRole('heading', { name: /Debug tools/ })).toBeInTheDocument();
  });

  it('long-pressing a tab jumps to Connection settings', () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      const home = tabButton('Home');
      fireEvent.pointerDown(home);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // Contextual action: Connection settings screen opens.
      expect(screen.getAllByText('Connection settings').length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
