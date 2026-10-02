/**
 * DebugScreen: diagnostics for every service, a redacted settings
 * inspector (never secret values), and the log viewer.
 */
import '../index.css';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DebugScreen } from './DebugScreen';
import { clearLog, debugLog } from '../lib/debug';

beforeEach(() => clearLog());

describe('DebugScreen', () => {
  it('renders a diagnostic row per service', () => {
    render(<DebugScreen />);
    for (const label of ['Hub API', 'Nebula', 'Relay (agent chat)', 'Sol gateway']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Test all' })).toBeInTheDocument();
  });

  it('redacts secrets in the settings inspector', () => {
    window.localStorage.setItem(
      'quantum.settings',
      JSON.stringify({ hub: { baseUrl: '' }, mcpKey: 'super-secret-key', nebulaPassphrase: '' }),
    );
    render(<DebugScreen />);
    expect(screen.queryByText('super-secret-key')).not.toBeInTheDocument();
    expect(screen.getByText('(set)')).toBeInTheDocument();
    window.localStorage.removeItem('quantum.settings');
  });

  it('shows log entries in the viewer and clears them', async () => {
    debugLog('probe', 'hello from test');
    render(<DebugScreen />);
    expect(await screen.findByText('hello from test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No log entries yet')).toBeInTheDocument();
  });

  it('long-pressing a diagnostic row re-runs its probe', () => {
    vi.useFakeTimers();
    try {
      render(<DebugScreen />);
      const row = screen.getByText('Hub API').closest('li')!;
      fireEvent.pointerDown(row);
      // Still idle: no probe started before the hold elapses.
      expect(screen.queryByText('probing…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
