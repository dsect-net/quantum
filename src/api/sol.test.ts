/**
 * Sol gateway client tests — fetch is fully mocked.
 *
 * Covers the send/receive flow (streaming + non-streaming), every error
 * path, the empty-URL demo-mode config error, and the fleet endpoints.
 * No network is ever touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ago,
  agentActivityLine,
  deskLine,
  fetchFleetSnapshot,
  fetchModels,
  sendChatCompletion,
  SolApiError,
  solChatRoot,
  solFleetRoot,
  testSolConnection,
} from './sol';

const BASE = 'https://team.dsect.net';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  body: unknown;
};

function mockResponse(partial: Partial<MockResponse>): MockResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
    body: null,
    ...partial,
  };
}

function mockFetchOnce(response: MockResponse | Error) {
  const fetchMock = vi.fn();
  if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
  else fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('solChatRoot / solFleetRoot', () => {
  it('builds the chat root from a bare host', () => {
    expect(solChatRoot(BASE)).toBe('https://team.dsect.net/api/sol/v1');
    expect(solFleetRoot(BASE)).toBe('https://team.dsect.net/api/sol');
  });

  it('does not double /api/sol segments', () => {
    expect(solChatRoot('https://team.dsect.net/api/sol/')).toBe('https://team.dsect.net/api/sol/v1');
    expect(solChatRoot('https://team.dsect.net/api/sol/v1')).toBe('https://team.dsect.net/api/sol/v1');
  });

  it('trims trailing slashes', () => {
    expect(solChatRoot('https://team.dsect.net///')).toBe('https://team.dsect.net/api/sol/v1');
  });
});

describe('sendChatCompletion — config honesty', () => {
  it('empty base URL is a config error, never a fake reply', async () => {
    const err = await sendChatCompletion({
      baseUrl: '',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SolApiError);
    expect((err as SolApiError).code).toBe('config');
  });

  it('empty model is a config error', async () => {
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: '  ',
      messages: [{ role: 'user', content: 'hi' }],
    }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('config');
  });

  it('empty messages are a config error', async () => {
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [],
    }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('config');
  });
});

describe('sendChatCompletion — non-streaming', () => {
  it('resolves with the reply text and sends the gateway contract', async () => {
    const fetchMock = mockFetchOnce(
      mockResponse({
        json: async () => ({ choices: [{ message: { content: 'Hello back.' } }] }),
      }),
    );
    const text = await sendChatCompletion({
      baseUrl: BASE,
      model: 'local-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    });
    expect(text).toBe('Hello back.');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://team.dsect.net/api/sol/v1/chat/completions');
    expect((init.headers as Record<string, string>)['X-Sol-Request']).toBe('1');
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('local-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.stream).toBe(false);
  });

  it('returns empty string when the reply has no text (never null)', async () => {
    mockFetchOnce(mockResponse({ json: async () => ({ choices: [] }) }));
    const text = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
    expect(text).toBe('');
  });
});

describe('sendChatCompletion — streaming', () => {
  function sseResponse(chunks: string[]): MockResponse {
    const encoder = new TextEncoder();
    let index = 0;
    const body = {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    };
    return mockResponse({ body });
  }

  it('streams tokens and resolves with the full text', async () => {
    mockFetchOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const tokens: string[] = [];
    const text = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      onToken: (t) => tokens.push(t),
    });
    expect(text).toBe('Hello');
    expect(tokens).toEqual(['Hel', 'lo']);
  });

  it('skips malformed chunks without killing the stream', async () => {
    mockFetchOnce(
      sseResponse(['data: not-json\n\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']),
    );
    const text = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    expect(text).toBe('ok');
  });
});

describe('sendChatCompletion — errors', () => {
  it('maps HTTP errors with the gateway detail message', async () => {
    mockFetchOnce(
      mockResponse({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: 'engine exploded', code: 'engine_down' } }),
        json: async () => ({ error: { message: 'engine exploded', code: 'engine_down' } }),
      }),
    );
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SolApiError);
    const api = err as SolApiError;
    expect(api.code).toBe('http');
    expect(api.status).toBe(500);
    expect(api.apiCode).toBe('engine_down');
    expect(api.message).toContain('engine exploded');
  });

  it('maps a refused connection to a network error', async () => {
    mockFetchOnce(new TypeError('fetch failed'));
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('network');
  });

  it('maps AbortError to aborted', async () => {
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    mockFetchOnce(abort);
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('aborted');
  });

  it('maps unreadable JSON to invalid-json', async () => {
    mockFetchOnce(
      mockResponse({
        json: async () => {
          throw new SyntaxError('unexpected token');
        },
      }),
    );
    const err = await sendChatCompletion({
      baseUrl: BASE,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('invalid-json');
  });
});

describe('fetchModels / testSolConnection', () => {
  it('parses the model list and drops empties', async () => {
    mockFetchOnce(
      mockResponse({
        json: async () => ({ data: [{ id: 'a' }, { id: '' }, { id: 'b', object: 'model' }, {}] }),
      }),
    );
    const models = await fetchModels({ baseUrl: BASE });
    expect(models).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('rejects an empty base URL', async () => {
    const err = await fetchModels({ baseUrl: '' }).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('config');
  });

  it('reports whether the configured model is in the list', async () => {
    mockFetchOnce(mockResponse({ json: async () => ({ data: [{ id: 'a' }] }) }));
    const found = await testSolConnection({ baseUrl: BASE, model: 'a' });
    expect(found.ok).toBe(true);
    expect(found.modelFound).toBe(true);
    expect(found.models).toEqual([{ id: 'a' }]);
    expect(found.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a missing model honestly', async () => {
    mockFetchOnce(mockResponse({ json: async () => ({ data: [{ id: 'a' }] }) }));
    const result = await testSolConnection({ baseUrl: BASE, model: 'zzz' });
    expect(result.modelFound).toBe(false);
  });
});

describe('fleet endpoints', () => {
  it('parses the agents snapshot (agents + desk)', async () => {
    const fetchMock = mockFetchOnce(
      mockResponse({
        json: async () => ({
          agents: [{ id: 'qubit', name: 'Qubit', state: 'working' }],
          desk: { holder_kind: 'human' },
        }),
      }),
    );
    const snapshot = await fetchFleetSnapshot(BASE);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].id).toBe('qubit');
    expect(snapshot.desk?.holder_kind).toBe('human');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://team.dsect.net/api/sol/agents');
  });

  it('tolerates a missing agents array without crashing', async () => {
    mockFetchOnce(mockResponse({ json: async () => ({}) }));
    const snapshot = await fetchFleetSnapshot(BASE);
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.desk).toBeNull();
  });

  it('rejects a 200 HTML page as not_gateway', async () => {
    mockFetchOnce(
      mockResponse({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('not json');
        },
        text: async () => '<html>nope</html>',
      }),
    );
    const err = await fetchFleetSnapshot(BASE).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('not_gateway');
  });

  it('propagates gateway HTTP failures with their detail', async () => {
    mockFetchOnce(
      mockResponse({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'unknown tailnet user' }),
        text: async () => JSON.stringify({ detail: 'unknown tailnet user' }),
      }),
    );
    const err = await fetchFleetSnapshot(BASE).catch((e: unknown) => e);
    expect((err as SolApiError).code).toBe('http');
    expect((err as SolApiError).status).toBe(401);
  });
});

describe('helpers', () => {
  it('ago formats relative seconds', () => {
    expect(ago(null)).toBe('');
    expect(ago(10)).toBe('just now');
    expect(ago(150)).toBe('3m ago');
    expect(ago(7200)).toBe('2h ago');
    expect(ago(200000)).toBe('2d ago');
  });

  it('agentActivityLine prefers handoff reason, then status text', () => {
    expect(agentActivityLine({ id: 'x', name: 'X', handoff: { reason: 'need you' } })).toBe('need you');
    expect(agentActivityLine({ id: 'x', name: 'X', status: { text: 'thinking' } })).toBe('thinking');
    expect(agentActivityLine({ id: 'x', name: 'X' })).toBe('No activity on the desk yet');
  });

  it('deskLine describes the holder', () => {
    const agents = [{ id: 'q', name: 'Qubit', workspace: 'ws-qubit' }];
    expect(deskLine(null, agents)).toContain("isn't answering");
    expect(deskLine({ holder_kind: 'human' }, agents)).toBe('You have the desk.');
    expect(deskLine({ holder: 'ws-qubit' }, agents)).toBe('Qubit is using the desk.');
    expect(deskLine({}, agents)).toContain('free');
  });
});
