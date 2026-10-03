/**
 * Tailscale connectivity badge — honest tailnet reachability.
 *
 * Quantum talks to Scotty's home server over Tailscale (hostnames like
 * *.ts.net). When the Tailscale client on the phone isn't connected, every
 * server call fails with a confusing generic error. This module answers one
 * question with real probes and short timeouts:
 *
 *   connected     — a configured tailnet host answered (green)
 *   tailscale-off — plain internet works, the tailnet host didn't (amber)
 *   offline       — no internet at all (red)
 *   unconfigured  — no tailnet URLs configured; the badge hides itself
 *
 * Probing is platform-aware. Inside the Android WebView, browser fetch() is
 * subject to CORS, and tailnet hosts don't send ACAO headers — so a plain
 * fetch "fails" even when the host is reachable, which used to paint a
 * false Offline badge. On native we probe with CapacitorHttp (native HTTP,
 * no CORS) and read internet state from the Network plugin instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { getSettings, type QuantumSettings } from './settings';

export type TailnetState = 'connected' | 'tailscale-off' | 'offline' | 'unconfigured';

export interface TailnetStatus {
  state: TailnetState;
  /** The tailnet URL that was probed, or null when unconfigured. */
  probeUrl: string | null;
}

/** Canonical Android connectivity-check endpoint: 204, empty body, made for this. */
export const INTERNET_PROBE_URL = 'https://connectivitycheck.gstatic.com/generate_204';

/**
 * True when the URL points at the tailnet: *.ts.net / *.tailscale.net
 * hostnames, or Tailscale's 100.64.0.0/10 CGNAT range (plus 172.16.0.0/12,
 * used by some tailnet-adjacent setups).
 */
export function isTailnetHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'ts.net' || host.endsWith('.ts.net')) return true;
  if (host === 'tailscale.net' || host.endsWith('.tailscale.net')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  }
  return false;
}

/** First configured service URL that points at the tailnet, if any. */
export function findTailnetUrl(settings: QuantumSettings): string | null {
  const urls = [
    settings.hub.baseUrl,
    settings.nebula.baseUrl,
    settings.relay.baseUrl,
    settings.sol.baseUrl,
  ];
  return urls.find((u) => u && isTailnetHost(u)) ?? null;
}

async function canReach(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Any HTTP response — even a 404 — proves the host is reachable.
    // Only a transport failure (DNS, refused, timeout) returns false.
    await fetchFn(url, { cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Native reachability probe via CapacitorHttp. Native HTTP is not subject
 * to CORS, so a tailnet host that answers over the VPN counts as reachable
 * even though its responses carry no Access-Control-Allow-Origin header.
 * Any HTTP response — even a 404 — proves the host is reachable; only a
 * transport failure (DNS, refused, timeout) returns false.
 */
async function nativeCanReach(url: string, timeoutMs: number): Promise<boolean> {
  try {
    await CapacitorHttp.get({ url, connectTimeout: timeoutMs, readTimeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the tailnet, then the open internet, and classify honestly.
 * Order matters: tailnet first (fast fail when Tailscale is off), then the
 * internet check to distinguish "Tailscale off" from "no connection".
 */
export async function checkTailnetStatus(
  settings: QuantumSettings,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<TailnetStatus> {
  const probeUrl = findTailnetUrl(settings);
  if (!probeUrl) return { state: 'unconfigured', probeUrl: null };

  if (Capacitor.isNativePlatform()) {
    if (await nativeCanReach(probeUrl, timeoutMs)) {
      return { state: 'connected', probeUrl };
    }
    // The OS knows whether we have internet; no CORS-blocked fetch needed.
    try {
      const net = await Network.getStatus();
      return { state: net.connected ? 'tailscale-off' : 'offline', probeUrl };
    } catch {
      return { state: 'offline', probeUrl };
    }
  }

  if (await canReach(fetchFn, probeUrl, timeoutMs)) {
    return { state: 'connected', probeUrl };
  }
  if (await canReach(fetchFn, INTERNET_PROBE_URL, timeoutMs)) {
    return { state: 'tailscale-off', probeUrl };
  }
  return { state: 'offline', probeUrl };
}

export const TAILNET_LABEL: Record<Exclude<TailnetState, 'unconfigured'>, string> = {
  connected: 'Tritium connected',
  'tailscale-off': 'Tailscale may be off',
  offline: 'Offline',
};

const POLL_MS = 60_000;

/** Live tailnet status: checks on mount, every minute, and on online/offline. */
export function useTailscaleStatus(): TailnetStatus & { refresh: () => void } {
  const [status, setStatus] = useState<TailnetStatus>({
    state: 'unconfigured',
    probeUrl: null,
  });
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    void checkTailnetStatus(getSettings()).then((s) => {
      if (mounted.current) setStatus(s);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [refresh]);

  return { ...status, refresh };
}
