/**
 * Quantum connection settings — Sol's pattern, per-service.
 *
 * Every field ships EMPTY (honest demo mode: no network calls until a base
 * URL is configured and tested). "Use recommended" quick-fills point at
 * Scotty's tailnet addresses — plain network addresses, not secrets.
 * Bearer worker keys / passphrases are entered by the user and stored via
 * Capacitor Preferences; they never appear in code.
 *
 * Services:
 *  - hub:    hub-api (dashboard endpoints + MCP gateway POST /mcp)
 *  - nebula: Nebula ComfyUI PWA backend (/api/run, /api/status, /api/jobs, /api/gallery)
 *  - relay:  agent-chat Hermes relay (/messages?since=, /recent, /search, /send, /ask)
 *  - sol:    Sol gateway (OpenAI chat at /api/sol/v1 + fleet agents at /api/sol)
 */
import { Preferences } from '@capacitor/preferences';

export type ServiceId = 'hub' | 'nebula' | 'relay' | 'sol';

export interface ServiceConfig {
  /** Base URL, e.g. https://tritium-linux.fairy-chinstrap.ts.net — empty = demo mode. */
  baseUrl: string;
}

export interface QuantumSettings {
  hub: ServiceConfig;
  nebula: ServiceConfig;
  relay: ServiceConfig;
  /** Sol gateway base (chat + fleet). Empty = demo mode. */
  sol: ServiceConfig;
  /** Optional MCP Bearer worker key (hub /mcp). Never logged, never in code. */
  mcpKey: string;
  /** Optional Nebula off-tailnet passphrase. Never logged, never in code. */
  nebulaPassphrase: string;
}

export const SERVICE_META: Record<
  ServiceId,
  { label: string; description: string; recommended: string; testPath: string }
> = {
  hub: {
    label: 'Hub API',
    description: 'Dashboard endpoints (services, agents, docket, logs, metrics) and the MCP gateway.',
    recommended: 'https://tritium-linux.fairy-chinstrap.ts.net',
    testPath: '/api/services',
  },
  nebula: {
    label: 'Nebula',
    description: 'ComfyUI image-generation backend: runs, jobs, gallery, workflows.',
    recommended: 'https://tritium-linux.fairy-chinstrap.ts.net:8188',
    testPath: '/api/status',
  },
  relay: {
    label: 'Relay (agent chat)',
    description: 'Hermes relay: messages, recent, search, send, ask.',
    recommended: 'https://team.dsect.net/api/relay',
    testPath: '/recent?limit=1',
  },
  sol: {
    label: 'Sol gateway',
    description:
      'Conversational AI: OpenAI-compatible chat at /api/sol/v1 and the live fleet agents view at /api/sol. No key in the app — identity is the tailnet.',
    recommended: 'https://team.dsect.net',
    testPath: '/api/sol/agents',
  },
};

export const SETTINGS_KEY = 'quantum.settings';

export const EMPTY_SETTINGS: QuantumSettings = Object.freeze({
  hub: { baseUrl: '' },
  nebula: { baseUrl: '' },
  relay: { baseUrl: '' },
  sol: { baseUrl: '' },
  mcpKey: '',
  nebulaPassphrase: '',
}) as QuantumSettings;

const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

/** Normalize a base URL: trim, drop trailing slashes. Returns '' for blank input. */
export function normalizeBaseUrl(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

/**
 * Validate a base URL. Empty string is VALID — it means demo mode.
 * Returns an error message for malformed input, or null when acceptable.
 */
export function validateBaseUrl(raw: unknown): string | null {
  const url = String(raw ?? '').trim();
  if (!url) return null; // empty = honest demo mode
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a full URL starting with http:// or https://';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http:// and https:// URLs are allowed';
  }
  return null;
}

/** True when the user has entered an MCP worker key. */
export function mcpKeyConfigured(settings: QuantumSettings): boolean {
  return settings.mcpKey.trim().length > 0;
}

/** True when no service has a configured base URL — the app must say so honestly. */
export function isDemoMode(settings: QuantumSettings): boolean {
  return !settings.hub.baseUrl && !settings.nebula.baseUrl && !settings.relay.baseUrl && !settings.sol.baseUrl;
}

export function getSettings(): QuantumSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(storageGet(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return {
    hub: { baseUrl: normalizeBaseUrl((raw.hub as ServiceConfig | undefined)?.baseUrl) },
    nebula: { baseUrl: normalizeBaseUrl((raw.nebula as ServiceConfig | undefined)?.baseUrl) },
    relay: { baseUrl: normalizeBaseUrl((raw.relay as ServiceConfig | undefined)?.baseUrl) },
    sol: { baseUrl: normalizeBaseUrl((raw.sol as ServiceConfig | undefined)?.baseUrl) },
    mcpKey: String((raw as { mcpKey?: unknown }).mcpKey ?? ''),
    nebulaPassphrase: String((raw as { nebulaPassphrase?: unknown }).nebulaPassphrase ?? ''),
  };
}

export async function saveSettings(settings: QuantumSettings): Promise<void> {
  const clean: QuantumSettings = {
    hub: { baseUrl: normalizeBaseUrl(settings.hub.baseUrl) },
    nebula: { baseUrl: normalizeBaseUrl(settings.nebula.baseUrl) },
    relay: { baseUrl: normalizeBaseUrl(settings.relay.baseUrl) },
    sol: { baseUrl: normalizeBaseUrl(settings.sol.baseUrl) },
    mcpKey: settings.mcpKey,
    nebulaPassphrase: settings.nebulaPassphrase,
  };
  const serialized = JSON.stringify(clean);
  storageSet(SETTINGS_KEY, serialized);
  try {
    await Preferences.set({ key: SETTINGS_KEY, value: serialized });
  } catch {
    // localStorage fallback already written above
  }
}

/** A per-service GET against a known endpoint. Throws on any failure. */
export async function testServiceConnection(
  service: ServiceId,
  baseUrl: string,
  timeoutMs = 8000,
): Promise<{ ok: true; status: number }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('No base URL configured — demo mode.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + SERVICE_META[service].testPath, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${SERVICE_META[service].label}`);
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}
