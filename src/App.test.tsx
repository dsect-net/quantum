/**
 * App shell: all 5 tabs render and navigate; the kit CSS (layered Tailwind
 * entry, tokens, Untitled bridge) imports without crashing.
 */
import './index.css';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

const TAB_LABELS = ['Home', 'Chat', 'Create', 'Messages', 'More'];

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
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const home = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent === 'Home',
    )!;
    expect(home).toHaveAttribute('aria-current', 'page');
  });

  it('switches tabs and shows honest Phase-4 placeholders', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const create = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create',
    )!;
    fireEvent.click(create);
    expect(screen.getAllByText('Create').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Coming soon — Phase 4/)).toBeInTheDocument();
    expect(screen.getByText(/Nebula API/)).toBeInTheDocument();
  });

  it('reaches the real Connection settings screen from More', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const more = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent === 'More',
    )!;
    fireEvent.click(more);
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
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const more = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent === 'More',
    )!;
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: /Connection settings/ }));
    const input = screen.getByLabelText(/Hub API base URL/);
    fireEvent.change(input, { target: { value: 'not a url' } });
    expect(
      screen.getByText(/Enter a full URL starting with http/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });
});
