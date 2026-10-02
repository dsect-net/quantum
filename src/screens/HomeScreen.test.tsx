/**
 * HomeScreen tests — honest states, not mocked pixels:
 *  - demo mode (no hub URL): the DemoBanner renders and fetch is never called
 *  - configured success: real mocked hub-api payloads render into sections
 *  - HTTP failure: sections degrade with the honest error, not fake data
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import { SETTINGS_KEY } from '../lib/settings';

const BASE = 'https://tritium-linux.fairy-chinstrap.ts.net';

function setHubUrl(url: string) {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      hub: { baseUrl: url },
      nebula: { baseUrl: '' },
      relay: { baseUrl: '' },
      mcpKey: '',
      nebulaPassphrase: '',
    }),
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function allHealthy() {
  return mockFetch((url) => {
    if (url.endsWith('/api/services'))
      return json([
        { id: 'hub-api', name: 'Hub API', cat: 'Infra', port: 443 },
        { id: 'nebula', name: 'Nebula', cat: 'AI', port: 8092 },
      ]);
    if (url.endsWith('/api/status'))
      return json([
        { id: 'hub-api', status: 'up', latencyMs: 9, code: 200, sinceSec: 3600 },
        { id: 'nebula', status: 'down', latencyMs: null, code: null },
      ]);
    if (url.endsWith('/api/agents'))
      return json([{ slug: 'qubit', name: 'Qubit', entries: 7 }]);
    if (url.endsWith('/api/vitals'))
      return json({
        cpuPct: 12,
        memPct: 55,
        memUsedGB: 17.1,
        memTotalGB: 31.2,
        load1: 2.1,
        uptimeSec: 90061,
        gpus: [{ vendor: 'amd', tempC: 46.5 }],
      });
    if (url.includes('/api/metrics'))
      return json([
        { t: 1, cpu: 10, mem: 55, load: 2.0 },
        { t: 2, cpu: 14, mem: 55, load: 2.2 },
      ]);
    if (url.includes('/api/docket/items'))
      return json([
        { id: 'd1', title: 'Porch light', status: 'queued', category: 'Home', updatedAt: '2026-10-01T12:00:00Z' },
      ]);
    throw new Error(`unexpected ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('HomeScreen demo mode', () => {
  it('renders the DemoBanner and never fetches without a base URL', async () => {
    window.localStorage.clear(); // getSettings() → EMPTY_SETTINGS
    const fetchFn = mockFetch(() => json({}));
    render(<HomeScreen />);
    // Banner + one honest per-section empty state each (5 total), never fake data.
    expect(screen.getAllByText('Demo mode')).toHaveLength(5);
    expect(
      screen.getAllByText(/No Hub API base URL configured/),
    ).toHaveLength(5);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('HomeScreen connected', () => {
  it('renders services, metrics, agents and docket from the hub', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    // Services: merged registry + probes, problems first.
    expect(await screen.findByText('Hub API')).toBeInTheDocument();
    expect(screen.getByText('Nebula')).toBeInTheDocument();
    const summary = screen.getByTestId('services-summary');
    expect(summary.textContent).toContain('1/2');
    expect(summary.textContent).toContain('up');
    expect(screen.getByText('down')).toBeInTheDocument();

    // Metrics: vitals through the kit Metric/Meter components.
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText(/17.1 \/ 31.2 GB/)).toBeInTheDocument();

    // Agents roster.
    expect(screen.getByText('Qubit')).toBeInTheDocument();

    // Docket board.
    expect(screen.getByText('Porch light')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  it('degrades honestly when the hub is unreachable', async () => {
    setHubUrl(BASE);
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    render(<HomeScreen />);
    expect(await screen.findByText('Hub API unreachable')).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the Hub API/)).toBeInTheDocument();
  });

  it('degrades per section when only one endpoint fails', async () => {
    setHubUrl(BASE);
    mockFetch((url) => {
      if (url.endsWith('/api/services')) return json({ error: 'down' }, 503);
      if (url.endsWith('/api/status')) return json([]);
      if (url.endsWith('/api/agents')) return json([{ slug: 'qubit', name: 'Qubit' }]);
      if (url.endsWith('/api/vitals')) return json({ gpus: [] });
      if (url.includes('/api/metrics')) return json([]);
      if (url.includes('/api/docket/items')) return json([]);
      throw new Error(`unexpected ${url}`);
    });
    render(<HomeScreen />);
    // Services section degrades; agents still render.
    expect(await screen.findByText("Couldn't load this section")).toBeInTheDocument();
    expect(screen.getByText('Qubit')).toBeInTheDocument();
  });
});
