/**
 * Tailscale connectivity: host detection and the three-state probe logic.
 *
 * Fetches are fully mocked — these tests never touch the network.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  checkTailnetStatus,
  findTailnetUrl,
  INTERNET_PROBE_URL,
  isTailnetHost,
  TAILNET_LABEL,
  type TailnetStatus,
} from './tailscale';
import { EMPTY_SETTINGS, type QuantumSettings } from './settings';

function settingsWith(urls: Partial<Record<'hub' | 'nebula' | 'relay' | 'sol', string>>): QuantumSettings {
  return {
    ...EMPTY_SETTINGS,
    hub: { baseUrl: urls.hub ?? '' },
    nebula: { baseUrl: urls.nebula ?? '' },
    relay: { baseUrl: urls.relay ?? '' },
    sol: { baseUrl: urls.sol ?? '' },
  };
}

/** Fetch stub: reachable URLs resolve, the rest throw like a dead route. */
function mockFetch(reachable: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (reachable.some((r) => url.startsWith(r) || reachable.includes(url))) {
      return { ok: true, status: 204 } as Response;
    }
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
}

describe('isTailnetHost', () => {
  it('detects *.ts.net hostnames', () => {
    expect(isTailnetHost('https://tritium-linux.fairy-chinstrap.ts.net')).toBe(true);
    expect(isTailnetHost('https://tritium-linux.fairy-chinstrap.ts.net:8188/api')).toBe(true);
  });

  it('detects *.tailscale.net hostnames', () => {
    expect(isTailnetHost('https://host.tail12345.ts.net'.replace('.ts.net', '.tailscale.net'))).toBe(
      true,
    );
  });

  it('detects Tailscale CGNAT and 172.16 ranges', () => {
    expect(isTailnetHost('http://100.64.0.1:8080')).toBe(true);
    expect(isTailnetHost('http://100.127.255.1')).toBe(true);
    expect(isTailnetHost('http://172.16.5.4')).toBe(true);
  });

  it('rejects public and LAN hosts', () => {
    expect(isTailnetHost('https://team.dsect.net')).toBe(false);
    expect(isTailnetHost('https://github.com')).toBe(false);
    expect(isTailnetHost('http://192.168.1.10')).toBe(false);
    expect(isTailnetHost('http://100.63.0.1')).toBe(false); // just outside 100.64/10
    expect(isTailnetHost('not a url')).toBe(false);
    expect(isTailnetHost('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isTailnetHost('https://HOST.TS.NET')).toBe(true);
  });
});

describe('findTailnetUrl', () => {
  it('returns the first configured tailnet URL', () => {
    const s = settingsWith({
      hub: 'https://tritium-linux.fairy-chinstrap.ts.net',
      relay: 'https://team.dsect.net/api/relay',
    });
    expect(findTailnetUrl(s)).toBe('https://tritium-linux.fairy-chinstrap.ts.net');
  });

  it('returns null when nothing tailnet is configured', () => {
    const s = settingsWith({ relay: 'https://team.dsect.net/api/relay' });
    expect(findTailnetUrl(s)).toBeNull();
    expect(findTailnetUrl(EMPTY_SETTINGS)).toBeNull();
  });
});

describe('checkTailnetStatus', () => {
  const TAIL = 'https://tritium-linux.fairy-chinstrap.ts.net';

  it('is unconfigured when no tailnet URLs are set', async () => {
    const st: TailnetStatus = await checkTailnetStatus(
      settingsWith({ relay: 'https://team.dsect.net' }),
      mockFetch([INTERNET_PROBE_URL]),
    );
    expect(st).toEqual({ state: 'unconfigured', probeUrl: null });
  });

  it('reports connected when the tailnet host answers', async () => {
    const st = await checkTailnetStatus(
      settingsWith({ hub: TAIL }),
      mockFetch([TAIL, INTERNET_PROBE_URL]),
    );
    expect(st).toEqual({ state: 'connected', probeUrl: TAIL });
  });

  it('reports tailscale-off when internet works but the tailnet does not', async () => {
    const st = await checkTailnetStatus(
      settingsWith({ hub: TAIL }),
      mockFetch([INTERNET_PROBE_URL]),
    );
    expect(st).toEqual({ state: 'tailscale-off', probeUrl: TAIL });
  });

  it('reports offline when nothing answers', async () => {
    const st = await checkTailnetStatus(settingsWith({ hub: TAIL }), mockFetch([]));
    expect(st).toEqual({ state: 'offline', probeUrl: TAIL });
  });

  it('treats any HTTP status as reachable (even 404)', async () => {
    const fetchFn = (async () => ({ ok: false, status: 404 }) as Response) as typeof fetch;
    const st = await checkTailnetStatus(settingsWith({ hub: TAIL }), fetchFn);
    expect(st.state).toBe('connected');
  });
});

describe('TAILNET_LABEL', () => {
  it('labels every visible state in plain words', () => {
    expect(TAILNET_LABEL.connected).toBe('Tritium connected');
    expect(TAILNET_LABEL['tailscale-off']).toBe('Tailscale may be off');
    expect(TAILNET_LABEL.offline).toBe('Offline');
  });
});

describe('checkTailnetStatus (native)', () => {
  const TAIL = 'https://tritium-linux.fairy-chinstrap.ts.net';

  beforeEach(() => {
    vi.resetModules();
  });

  async function loadNative(opts: { httpOk: boolean; netConnected: boolean }) {
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
      CapacitorHttp: {
        get: vi.fn(async () => {
          if (!opts.httpOk) throw new Error('Failed to fetch');
          return { status: 200, data: '' };
        }),
      },
    }));
    vi.doMock('@capacitor/network', () => ({
      Network: { getStatus: vi.fn(async () => ({ connected: opts.netConnected })) },
    }));
    return (await import('./tailscale')) as typeof import('./tailscale');
  }

  it('reports connected when the native tailnet probe answers (no CORS involved)', async () => {
    const m = await loadNative({ httpOk: true, netConnected: true });
    const st = await m.checkTailnetStatus(settingsWith({ hub: TAIL }));
    expect(st).toEqual({ state: 'connected', probeUrl: TAIL });
  });

  it('reports tailscale-off when the tailnet probe fails but the OS has internet', async () => {
    const m = await loadNative({ httpOk: false, netConnected: true });
    const st = await m.checkTailnetStatus(settingsWith({ hub: TAIL }));
    expect(st).toEqual({ state: 'tailscale-off', probeUrl: TAIL });
  });

  it('reports offline when the tailnet probe fails and the OS has no internet', async () => {
    const m = await loadNative({ httpOk: false, netConnected: false });
    const st = await m.checkTailnetStatus(settingsWith({ hub: TAIL }));
    expect(st).toEqual({ state: 'offline', probeUrl: TAIL });
  });
});
