/**
 * HomeScreen tests — honest states, not mocked pixels:
 *  - demo mode (no hub URL): the DemoBanner renders and fetch is never called
 *  - configured success: real mocked hub-api payloads render into sections
 *  - HTTP failure: sections degrade with the honest error, not fake data
 *
 * The demo-mode count (9) tracks the eight data sections of the www-mirrored
 * IA plus the DemoBanner itself: Hero, At a glance, Services, System vitals,
 * Graphics, Agents, Wishlist, Addresses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    if (url.endsWith('/api/summary'))
      return json({
        services: { up: 1, total: 2, pct: 50.0, medianLatencyMs: 9, p95LatencyMs: 9 },
        agents: 1,
      });
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
        gpus: [{ vendor: 'amd', tempC: 46.5, busyPct: 10 }],
      });
    if (url.includes('/api/metrics'))
      return json([
        { t: 1, cpu: 10, mem: 55, load: 2.0, watts: 48.2 },
        { t: 2, cpu: 14, mem: 55, load: 2.2, watts: 52.0 },
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
    // Banner + one honest per-section empty state each (8 sections + the
    // banner badge itself), never fake data.
    expect(screen.getAllByText('Demo mode')).toHaveLength(9);
    expect(
      screen.getAllByText(/No Hub API base URL configured/),
    ).toHaveLength(9);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('HomeScreen connected', () => {
  it('renders services, metrics, agents and docket from the hub', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    // Services: merged registry + probes, problems first (scoped: names also
    // appear in the Addresses directory below).
    const servicesList = within(await screen.findByTestId('services-list'));
    expect(servicesList.getByText('Hub API')).toBeInTheDocument();
    expect(servicesList.getByText('Nebula')).toBeInTheDocument();
    const summary = screen.getByTestId('services-summary');
    expect(summary.textContent).toContain('1/2');
    expect(summary.textContent).toContain('up');
    // 'down' badge renders in the services list and the addresses directory.
    expect(screen.getAllByText('down')).toHaveLength(2);

    // Metrics: vitals through the kit Metric/Meter components.
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText(/17.1 \/ 31.2 GB/)).toBeInTheDocument();

    // Agents roster.
    expect(screen.getByText('Qubit')).toBeInTheDocument();

    // Wishlist board.
    expect(screen.getByText('Porch light')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  it('renders the www-mirrored hero and at-a-glance block', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    // Hero: time-of-day greeting, date kicker, services indexed.
    expect(
      await screen.findByText(/Good (morning|afternoon|evening),/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 services indexed/)).toBeInTheDocument();

    // At a glance: hub link state from the summary roll-up.
    expect(screen.getByText('1 SERVICE DOWN')).toBeInTheDocument();

    // Stat tiles. The GPU temp shows twice: the stat tile and the Graphics card.
    expect(screen.getByText('Median latency')).toBeInTheDocument();
    expect(screen.getByText('p95 9 ms')).toBeInTheDocument();
    expect(screen.getAllByText('46.5 °C')).toHaveLength(2);
    // Uptime shows twice: the glance tile and the vitals foot (as on the www).
    expect(screen.getAllByText('1d 1h')).toHaveLength(2);

    // Glance rows: power from the latest metrics sample, agent count.
    expect(screen.getByText('52 W')).toBeInTheDocument();
    expect(screen.getByText('1 on record')).toBeInTheDocument();
  });

  it('renders the port → name directory from the registry', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    expect(await screen.findByText('10 · Addresses')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:443')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:8092')).toBeInTheDocument();
  });

  it('filters services through the search field', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    await screen.findByTestId('services-list');
    const servicesList = () => within(screen.getByTestId('services-list'));
    fireEvent.change(screen.getByLabelText('Search services'), {
      target: { value: 'hub' },
    });
    expect(servicesList().getByText('Hub API')).toBeInTheDocument();
    expect(servicesList().queryByText('Nebula')).not.toBeInTheDocument();
  });

  it('cycles the sort order and hides attention-needed services', async () => {
    setHubUrl(BASE);
    allHealthy();
    render(<HomeScreen />);

    await screen.findByTestId('services-list');
    // Default: needs attention first → Nebula (down) above Hub API (up).
    const names = () =>
      within(screen.getByTestId('services-list'))
        .getAllByText(/Hub API|Nebula/)
        .map((el) => el.textContent);
    expect(names()[0]).toBe('Nebula');

    fireEvent.click(screen.getByText('Sort · Needs attention'));
    expect(screen.getByText('Sort · Name A–Z')).toBeInTheDocument();
    expect(names()[0]).toBe('Hub API');

    fireEvent.click(screen.getByLabelText('Hide attention-needed'));
    const scoped = within(screen.getByTestId('services-list'));
    expect(scoped.getByText('Hub API')).toBeInTheDocument();
    expect(scoped.queryByText('Nebula')).not.toBeInTheDocument();
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
      if (url.endsWith('/api/summary')) return json({ services: null, agents: null });
      if (url.endsWith('/api/vitals')) return json({ gpus: [] });
      if (url.includes('/api/metrics')) return json([]);
      if (url.includes('/api/docket/items')) return json([]);
      throw new Error(`unexpected ${url}`);
    });
    render(<HomeScreen />);
    // Services + Addresses sections degrade; agents still render.
    expect(
      await screen.findAllByText("Couldn't load this section"),
    ).toHaveLength(2);
    expect(screen.getByText('Qubit')).toBeInTheDocument();
  });

  it('degrades hero and glance when only the summary endpoint fails', async () => {
    setHubUrl(BASE);
    mockFetch((url) => {
      if (url.endsWith('/api/services'))
        return json([{ id: 'hub-api', name: 'Hub API', cat: 'Infra' }]);
      if (url.endsWith('/api/status'))
        return json([{ id: 'hub-api', status: 'up', latencyMs: 9 }]);
      if (url.endsWith('/api/summary')) return json({ error: 'down' }, 503);
      if (url.endsWith('/api/agents')) return json([]);
      if (url.endsWith('/api/vitals')) return json({ gpus: [] });
      if (url.includes('/api/metrics')) return json([]);
      if (url.includes('/api/docket/items')) return json([]);
      throw new Error(`unexpected ${url}`);
    });
    render(<HomeScreen />);
    // Hero + At a glance degrade; services still render.
    expect(
      await screen.findAllByText("Couldn't load this section"),
    ).toHaveLength(2);
    const servicesList = within(await screen.findByTestId('services-list'));
    expect(servicesList.getByText('Hub API')).toBeInTheDocument();
  });
});
